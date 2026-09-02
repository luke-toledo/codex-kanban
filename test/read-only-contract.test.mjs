import assert from "node:assert/strict";
import test from "node:test";
import { assertReadOnlyMethod } from "../lib/codex-client.mjs";

test("allows only the App Server methods needed to inspect Codex tasks", () => {
  for (const method of ["initialize", "thread/list", "thread/read"]) {
    assert.doesNotThrow(() => assertReadOnlyMethod(method));
  }
});

test("rejects App Server methods that create or change Codex work", () => {
  for (const method of [
    "thread/start",
    "thread/resume",
    "turn/start",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
  ]) {
    assert.throws(() => assertReadOnlyMethod(method), /cannot call write method/);
  }
});
