import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

const INTERACTIVE_SOURCES = ["cli", "vscode", "appServer"];
const READ_ONLY_METHODS = new Set(["initialize", "thread/list", "thread/read"]);

export function assertReadOnlyMethod(method) {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error(`Codex Kanban cannot call write method: ${method}`);
  }
}

export class CodexClient extends EventEmitter {
  constructor({ command = "codex" } = {}) {
    super();
    this.command = command;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
  }

  async start() {
    if (this.ready) return;
    this.child = spawn(this.command, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.on("error", (error) => this.#close(error));
    this.child.on("exit", (code, signal) => {
      this.#close(new Error(`Codex App Server exited (${code ?? signal})`));
    });
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message && !message.includes("could not create PATH aliases")) {
        console.error(`[codex] ${message}`);
      }
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.#handleLine(line));

    await this.#request(
      "initialize",
      {
        clientInfo: {
          name: "codex_kanban",
          title: "Codex Kanban",
          version: "0.2.0",
        },
      },
      20_000,
    );
    this.#write({ method: "initialized", params: {} });
    this.ready = true;
  }

  #request(method, params = {}, timeoutMs = 60_000) {
    assertReadOnlyMethod(method);
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error("Codex App Server is not running"));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      timeout.unref();
      this.pending.set(String(id), { resolve, reject, timeout });
      this.#write({ id, method, params });
    });
  }

  async listThreads() {
    const threads = [];
    let cursor = null;

    for (let page = 0; page < 20; page += 1) {
      const result = await this.#request("thread/list", {
        archived: false,
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: INTERACTIVE_SOURCES,
        useStateDbOnly: true,
      });
      threads.push(...(result?.data ?? []));
      cursor = result?.nextCursor ?? null;
      if (!cursor) break;
    }

    return threads.filter((thread) => !thread.parentThreadId);
  }

  readThread(threadId) {
    return this.#request("thread/read", { threadId, includeTurns: true });
  }

  stop() {
    this.child?.kill("SIGTERM");
  }

  #write(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.error("Ignored malformed App Server output");
      return;
    }

    if (message.method) {
      if (message.id != null) {
        if (message.method === "currentTime/read") {
          this.#write({
            id: message.id,
            result: { currentTimeAt: Math.floor(Date.now() / 1000) },
          });
          return;
        }
        this.#write({
          id: message.id,
          error: { code: -32_601, message: "Codex Kanban is read-only" },
        });
        return;
      }
      this.emit("notification", message);
      return;
    }

    if (message.id == null) return;
    const waiter = this.pending.get(String(message.id));
    if (!waiter) return;
    this.pending.delete(String(message.id));
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }

  #close(error) {
    if (!this.child) return;
    this.ready = false;
    this.child = null;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.pending.clear();
    this.emit("fatal", error);
  }
}
