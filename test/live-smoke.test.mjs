import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

test("live App Server streams an ephemeral Codex reply", { timeout: 120_000 }, async () => {
  const child = spawn("codex", ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map();
  let nextId = 1;
  let streamedText = "";
  let completedThreadId = null;
  let completeTurn;
  const turnCompleted = new Promise((resolve) => {
    completeTurn = resolve;
  });

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "currentTime/read" && message.id != null) {
      child.stdin.write(
        `${JSON.stringify({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } })}\n`,
      );
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      streamedText += message.params?.delta || "";
    }
    if (message.method === "turn/completed") {
      completedThreadId = message.params?.threadId || null;
      completeTurn();
    }
    if (message.id == null || message.method) return;
    const waiter = pending.get(String(message.id));
    if (!waiter) return;
    pending.delete(String(message.id));
    if (message.error) waiter.reject(new Error(message.error.message || "App Server error"));
    else waiter.resolve(message.result);
  });

  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(String(id), { resolve, reject }));
  }

  try {
    await request("initialize", {
      clientInfo: { name: "codex-kanban-live-test", version: "0.1.0" },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    const started = await request("thread/start", { cwd: process.cwd(), ephemeral: true });
    await request("turn/start", {
      threadId: started.thread.id,
      input: [{ type: "text", text: "Reply with exactly STREAM_OK and nothing else." }],
    });
    await turnCompleted;

    assert.equal(completedThreadId, started.thread.id);
    assert.match(streamedText, /STREAM_OK/);
  } finally {
    child.kill("SIGTERM");
  }
});
