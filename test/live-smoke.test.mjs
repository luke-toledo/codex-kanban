import assert from "node:assert/strict";
import test from "node:test";
import { CodexClient } from "../lib/codex-client.mjs";

test("live App Server lists and reads Codex tasks without writing", { timeout: 120_000 }, async () => {
  const client = new CodexClient();

  try {
    await client.start();
    const threads = await client.listThreads();
    assert.ok(Array.isArray(threads));

    if (threads[0]) {
      const result = await client.readThread(threads[0].id);
      assert.equal(result.thread.id, threads[0].id);
    }
  } finally {
    client.stop();
  }
});
