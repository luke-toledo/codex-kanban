import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { reviewServerRequest } from "./approval-policy.mjs";

const INTERACTIVE_SOURCES = ["cli", "vscode", "appServer"];

export class CodexClient extends EventEmitter {
  constructor({ command = "codex" } = {}) {
    super();
    this.command = command;
    this.child = null;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.items = new Map();
    this.loadedThreads = new Set();
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

    await this.request(
      "initialize",
      {
        clientInfo: {
          name: "codex_kanban",
          title: "Codex Kanban",
          version: "0.1.0",
        },
      },
      20_000,
    );
    this.notify("initialized", {});
    this.ready = true;
  }

  request(method, params = {}, timeoutMs = 60_000) {
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

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  async listThreads() {
    const threads = [];
    let cursor = null;

    for (let page = 0; page < 20; page += 1) {
      const result = await this.request("thread/list", {
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
    return this.request("thread/read", { threadId, includeTurns: true });
  }

  async startThread(cwd) {
    const result = await this.request("thread/start", { cwd }, 90_000);
    this.loadedThreads.add(result.thread.id);
    return result;
  }

  async resumeThread(threadId) {
    if (this.loadedThreads.has(threadId)) return;
    const result = await this.request("thread/resume", { threadId }, 90_000);
    if (result?.thread?.id !== threadId) {
      throw new Error("Codex resumed a different thread");
    }
    this.loadedThreads.add(threadId);
  }

  async startTurn(threadId, text, clientUserMessageId) {
    await this.resumeThread(threadId);
    return this.request(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text }],
        clientUserMessageId,
      },
      90_000,
    );
  }

  getServerRequests() {
    return [...this.serverRequests.values()].map((request) =>
      reviewServerRequest(request, this.items.get(request.params?.itemId)),
    );
  }

  respondToServerRequest(requestId, response) {
    const request = this.serverRequests.get(String(requestId));
    if (!request) throw new Error("Approval request is no longer pending");
    const result = buildServerResponse(request, response, {
      item: this.items.get(request.params?.itemId),
    });
    this.#write({ id: request.id, result });
    this.serverRequests.delete(String(requestId));
    this.emit("serverRequestResolved", { requestId: String(requestId) });
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
        this.serverRequests.set(String(message.id), message);
        this.emit(
          "serverRequest",
          reviewServerRequest(message, this.items.get(message.params?.itemId)),
        );
        return;
      }
      this.#rememberItem(message.params?.item);
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
    this.loadedThreads.clear();
    this.items.clear();
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.pending.clear();
    this.emit("fatal", error);
  }

  #rememberItem(item) {
    if (!item?.id) return;
    this.items.set(item.id, item);
    while (this.items.size > 1_000) this.items.delete(this.items.keys().next().value);

    for (const request of this.serverRequests.values()) {
      if (request.params?.itemId !== item.id) continue;
      this.emit("serverRequest", reviewServerRequest(request, item));
    }
  }
}

export function buildServerResponse(request, response = {}, { item = null } = {}) {
  if (request.method === "item/tool/requestUserInput") {
    if (!response.answers || typeof response.answers !== "object" || Array.isArray(response.answers)) {
      throw new Error("Answers are required");
    }
    return { answers: response.answers };
  }

  if (response.action !== "accept" && response.action !== "decline") {
    throw new Error("Action must be accept or decline");
  }
  const accepted = response.action === "accept";
  if (accepted && !reviewServerRequest(request, item).canAccept) {
    throw new Error("This request cannot be accepted safely in Codex Kanban");
  }

  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: accepted ? "accept" : "decline" };
    case "execCommandApproval":
    case "applyPatchApproval":
      return {
        decision: accepted
          ? "approved"
          : { denied: { rejection: "Declined by the user in Codex Kanban" } },
      };
    case "item/permissions/requestApproval":
      return {
        permissions: accepted ? request.params.permissions : {},
        scope: "turn",
      };
    case "mcpServer/elicitation/request":
      if (accepted) throw new Error("MCP form and URL approvals are not supported in this V0");
      return { action: "decline" };
    default:
      throw new Error(`Unsupported Codex request: ${request.method}`);
  }
}
