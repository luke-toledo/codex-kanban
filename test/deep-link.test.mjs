import assert from "node:assert/strict";
import test from "node:test";
import { codexThreadUrl } from "../public/deep-link.js";

test("builds the canonical Codex desktop link for a local thread", () => {
  assert.equal(
    codexThreadUrl("01234567-89ab-cdef-0123-456789abcdef"),
    "codex://threads/01234567-89ab-cdef-0123-456789abcdef",
  );
});

test("rejects a missing thread ID", () => {
  assert.throws(() => codexThreadUrl(""), /thread ID/);
});
