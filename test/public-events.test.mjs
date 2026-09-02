import assert from "node:assert/strict";
import test from "node:test";
import { publicCodexNotification } from "../lib/public-events.mjs";

test("content-bearing live events never reach the browser", () => {
  const result = publicCodexNotification({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      secret: "do-not-forward",
      item: {
        id: "item-1",
        type: "commandExecution",
        command: "npm test",
        status: "completed",
        aggregatedOutput: "sensitive command output",
      },
    },
  });

  assert.equal(result, null);
  assert.equal(
    publicCodexNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "private text" },
    }),
    null,
  );
});

test("unknown App Server notifications are not sent to browsers", () => {
  assert.equal(
    publicCodexNotification({ method: "account/rateLimits/updated", params: { secret: true } }),
    null,
  );
});

test("errors sent to the browser omit internal details", () => {
  assert.deepEqual(
    publicCodexNotification({
      method: "error",
      params: { threadId: "thread-1", error: { message: "Failed", stack: "private" } },
    }),
    { method: "error", params: { message: "Codex reported an error" } },
  );
});

test("status-only events include only fields the board uses", () => {
  assert.deepEqual(
    publicCodexNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turnId: "turn-private", secret: "private" },
    }),
    { method: "turn/completed", params: { threadId: "thread-1" } },
  );
  assert.deepEqual(
    publicCodexNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
        status: { type: "active", privateDetail: "private" },
        secret: "private",
      },
    }),
    {
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "active" } },
    },
  );
});
