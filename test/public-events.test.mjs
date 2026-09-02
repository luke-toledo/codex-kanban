import assert from "node:assert/strict";
import test from "node:test";
import { publicCodexNotification } from "../lib/public-events.mjs";

test("live command events omit output and unrelated App Server fields", () => {
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

  assert.deepEqual(result, {
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "item-1",
        turnId: "turn-1",
        type: "activity",
        label: "Command",
        detail: "npm test",
        status: "completed",
      },
    },
  });
});

test("unknown App Server notifications are not sent to browsers", () => {
  assert.equal(
    publicCodexNotification({ method: "account/rateLimits/updated", params: { secret: true } }),
    null,
  );
});

test("errors expose only the message needed by the UI", () => {
  assert.deepEqual(
    publicCodexNotification({
      method: "error",
      params: { threadId: "thread-1", error: { message: "Failed", stack: "private" } },
    }),
    { method: "error", params: { threadId: "thread-1", message: "Failed" } },
  );
});
