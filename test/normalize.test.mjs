import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConversation, normalizeThread, threadTitle } from "../lib/normalize.mjs";

test("task titles use the first useful line and stay compact", () => {
  assert.equal(threadTitle({ name: null, preview: "\nBuild Google auth\nextra detail" }), "Build Google auth");
  assert.equal(threadTitle({ name: "Kanban Setup", preview: "ignored" }), "Kanban Setup");
});

test("task list omits the unused raw preview", () => {
  const thread = normalizeThread({
    id: "thread-a",
    preview: "private preview body",
    cwd: "/tmp/project",
  });
  assert.equal(Object.hasOwn(thread, "preview"), false);
  assert.equal(thread.hidden, false);
  assert.equal(normalizeThread({ id: "thread-b" }, { hidden: true }).hidden, true);
});

test("conversation normalization keeps messages and useful activity", () => {
  const result = normalizeConversation({
    id: "thread-a",
    cwd: "/tmp/project",
    preview: "Test",
    status: { type: "idle" },
    turns: [
      {
        id: "turn-a",
        items: [
          { id: "user-a", type: "userMessage", content: [{ type: "text", text: "Hello" }] },
          { id: "agent-a", type: "agentMessage", text: "Hi" },
          { id: "command-a", type: "commandExecution", command: "npm test", status: "completed" },
          { id: "reasoning-a", type: "reasoning", summary: ["hidden"] },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.messages.map(({ type, role, text, label }) => ({ type, role, text, label })),
    [
      { type: "message", role: "user", text: "Hello", label: undefined },
      { type: "message", role: "assistant", text: "Hi", label: undefined },
      { type: "activity", role: undefined, text: undefined, label: "Command" },
    ],
  );
});
