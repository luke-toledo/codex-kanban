import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BoardStore } from "../lib/board-store.mjs";
import { getBoardStatePath } from "../lib/state-path.mjs";

test("new Codex tasks enter backlog and placement survives restart", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  const store = new BoardStore(filePath);

  await store.syncThreadIds(["thread-a", "thread-b"]);
  assert.deepEqual(store.cards, [
    { threadId: "thread-a", column: "backlog", order: 0, hidden: false },
    { threadId: "thread-b", column: "backlog", order: 1, hidden: false },
  ]);

  await store.update([
    { threadId: "thread-a", column: "in-progress", order: 0, hidden: true },
    { threadId: "thread-b", column: "backlog", order: 0, hidden: false },
  ]);
  const reloaded = new BoardStore(filePath);
  await reloaded.load();
  assert.deepEqual(reloaded.cards, [
    { threadId: "thread-b", column: "backlog", order: 0, hidden: false },
    { threadId: "thread-a", column: "in-progress", order: 0, hidden: true },
  ]);

  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  assert.deepEqual(Object.keys(persisted[0]).sort(), ["column", "hidden", "order", "threadId"]);
});

test("invalid columns and duplicate task IDs are rejected", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new BoardStore(path.join(directory, "board.json"));

  await assert.rejects(
    store.update([{ threadId: "thread-a", column: "maybe", order: 0 }]),
    /valid task ID, column/,
  );
  await assert.rejects(
    store.update([
      { threadId: "thread-a", column: "todo", order: 0 },
      { threadId: "thread-a", column: "review", order: 0 },
    ]),
    /Duplicate threadId/,
  );
  await assert.rejects(
    store.update([{ threadId: "unknown", column: "todo", order: 0 }]),
    /known Codex tasks/,
  );
  await assert.rejects(
    store.update([{ threadId: "thread-a", column: "todo", order: 0, hidden: "yes" }]),
    /hidden state/,
  );
});

test("board state strips extra properties", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-minimal-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  await writeFile(
    filePath,
    `${JSON.stringify([{ threadId: "thread-a", column: "todo", order: 0, transcript: "no" }])}\n`,
    "utf8",
  );

  const store = new BoardStore(filePath);
  await store.load();
  await store.update([{ threadId: "thread-a", column: "done", order: 0, extra: "no" }]);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), [
    { threadId: "thread-a", column: "done", order: 0, hidden: false },
  ]);
});

test("board state uses the native per-user data location", () => {
  assert.equal(
    getBoardStatePath({
      platform: "darwin",
      env: { CODEX_KANBAN_STATE_DIR: "/tmp/custom-state" },
      homeDirectory: "/Users/ada",
    }),
    "/tmp/custom-state/board.json",
  );
  assert.equal(
    getBoardStatePath({ platform: "darwin", env: {}, homeDirectory: "/Users/ada" }),
    "/Users/ada/Library/Application Support/codex-kanban/board.json",
  );
  assert.equal(
    getBoardStatePath({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\Ada",
    }),
    "C:\\Users\\Ada\\AppData\\Roaming\\codex-kanban\\board.json",
  );
  assert.equal(
    getBoardStatePath({
      platform: "linux",
      env: { XDG_STATE_HOME: "/home/ada/.state" },
      homeDirectory: "/home/ada",
    }),
    "/home/ada/.state/codex-kanban/board.json",
  );
  assert.equal(
    getBoardStatePath({ platform: "linux", env: {}, homeDirectory: "/home/ada" }),
    "/home/ada/.local/state/codex-kanban/board.json",
  );
});

test("existing repository state migrates once without changing the legacy file", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-migration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const legacyFilePath = path.join(directory, "repo", "data", "board.json");
  const filePath = path.join(directory, "user-state", "board.json");
  const legacyCards = [
    { threadId: "thread-b", column: "todo", order: 4 },
    { threadId: "thread-a", column: "todo", order: 2 },
  ];
  await mkdir(path.dirname(legacyFilePath), { recursive: true });
  await writeFile(legacyFilePath, `${JSON.stringify(legacyCards)}\n`, "utf8");

  const migrated = new BoardStore(filePath, { legacyFilePath });
  await migrated.load();
  assert.deepEqual(migrated.cards, [
    { threadId: "thread-a", column: "todo", order: 0, hidden: false },
    { threadId: "thread-b", column: "todo", order: 1, hidden: false },
  ]);
  assert.deepEqual(JSON.parse(await readFile(legacyFilePath, "utf8")), legacyCards);

  await writeFile(
    legacyFilePath,
    `${JSON.stringify([{ threadId: "replacement", column: "done", order: 0 }])}\n`,
    "utf8",
  );
  const reloaded = new BoardStore(filePath, { legacyFilePath });
  await reloaded.load();
  assert.deepEqual(reloaded.cards, migrated.cards);
});

test("failed atomic writes leave no partial file and later writes can recover", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-atomic-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  const store = new BoardStore(filePath);
  await store.load();
  await store.syncThreadIds(["thread-a"]);

  await rm(filePath);
  await mkdir(filePath);
  await assert.rejects(
    store.update([{ threadId: "thread-a", column: "todo", order: 0 }]),
  );
  assert.deepEqual(store.cards, [
    { threadId: "thread-a", column: "backlog", order: 0, hidden: false },
  ]);
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    [],
  );

  await rm(filePath, { recursive: true });
  await store.update([{ threadId: "thread-a", column: "todo", order: 0 }]);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), [
    { threadId: "thread-a", column: "todo", order: 0, hidden: false },
  ]);
});
