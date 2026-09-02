import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const BOARD_COLUMNS = [
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
];

const COLUMN_SET = new Set(BOARD_COLUMNS);

function isCard(value) {
  return (
    value &&
    typeof value.threadId === "string" &&
    value.threadId.length > 0 &&
    COLUMN_SET.has(value.column) &&
    Number.isInteger(value.order) &&
    value.order >= 0
  );
}

export class BoardStore {
  constructor(filePath, { legacyFilePath = null } = {}) {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.cards = [];
    this.loaded = false;
    this.loadPromise = null;
    this.mutationQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return this.cards;
    if (!this.loadPromise) {
      this.loadPromise = this.#load().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  async #load() {
    try {
      this.cards = await this.#readCards(this.filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;

      const legacyCards = await this.#readLegacyCards();
      this.cards = legacyCards ?? [];
      if (legacyCards) await this.#persist();
    }

    this.loaded = true;
    return this.cards;
  }

  async #readLegacyCards() {
    if (
      !this.legacyFilePath ||
      path.resolve(this.legacyFilePath) === path.resolve(this.filePath)
    ) {
      return null;
    }

    try {
      return await this.#readCards(this.legacyFilePath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #readCards(filePath) {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(isCard)) {
      throw new Error("Board file is not a valid card list");
    }
    return this.#normalize(parsed);
  }

  syncThreadIds(threadIds) {
    return this.#enqueueMutation(() => this.#syncThreadIds(threadIds));
  }

  async #syncThreadIds(threadIds) {
    await this.load();
    const previousCards = this.cards;
    const nextCards = [...this.cards];
    const known = new Set(nextCards.map((card) => card.threadId));
    let nextOrder =
      Math.max(
        -1,
        ...nextCards
          .filter((card) => card.column === "backlog")
          .map((card) => card.order),
      ) + 1;
    let changed = false;

    for (const threadId of threadIds) {
      if (known.has(threadId)) continue;
      nextCards.push({ threadId, column: "backlog", order: nextOrder++ });
      known.add(threadId);
      changed = true;
    }

    if (changed) {
      this.cards = this.#normalize(nextCards);
      try {
        await this.#persist();
      } catch (error) {
        this.cards = previousCards;
        throw error;
      }
    }
    return this.cards;
  }

  update(nextCards) {
    return this.#enqueueMutation(() => this.#update(nextCards));
  }

  async #update(nextCards) {
    await this.load();
    if (!Array.isArray(nextCards) || !nextCards.every(isCard)) {
      throw new Error("Every card needs a threadId, valid column, and non-negative order");
    }

    const ids = new Set();
    for (const card of nextCards) {
      if (ids.has(card.threadId)) throw new Error("Duplicate threadId in board update");
      ids.add(card.threadId);
    }

    const previousCards = this.cards;
    const updates = new Map(nextCards.map((card) => [card.threadId, card]));
    this.cards = this.cards.map((card) => updates.get(card.threadId) ?? card);
    for (const card of nextCards) {
      if (!this.cards.some((existing) => existing.threadId === card.threadId)) {
        this.cards.push(card);
      }
    }
    this.cards = this.#normalize(this.cards);
    try {
      await this.#persist();
    } catch (error) {
      this.cards = previousCards;
      throw error;
    }
    return this.cards;
  }

  #enqueueMutation(operation) {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.catch(() => {});
    return result;
  }

  get(threadId) {
    return this.cards.find((card) => card.threadId === threadId) ?? null;
  }

  #normalize(cards) {
    const byId = new Map();
    for (const card of cards) byId.set(card.threadId, { ...card });

    const normalized = [];
    for (const column of BOARD_COLUMNS) {
      const columnCards = [...byId.values()]
        .filter((card) => card.column === column)
        .sort((left, right) => left.order - right.order || left.threadId.localeCompare(right.threadId));
      columnCards.forEach((card, order) => normalized.push({ ...card, order }));
    }
    return normalized;
  }

  async #persist() {
    const snapshot = `${JSON.stringify(this.cards, null, 2)}\n`;
    const write = this.writeQueue.then(() => this.#writeAtomically(snapshot));
    this.writeQueue = write.catch(() => {});
    return write;
  }

  async #writeAtomically(snapshot) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, snapshot, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
      }
      throw error;
    }
  }
}
