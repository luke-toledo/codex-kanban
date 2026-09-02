import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  isValidSessionToken,
} from "../lib/session-auth.mjs";

test("creates an unguessable URL-safe session token", () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test("accepts only the exact launch token", () => {
  const token = "a".repeat(43);
  assert.equal(isValidSessionToken(token, token), true);
  assert.equal(isValidSessionToken(`${token}x`, token), false);
  assert.equal(isValidSessionToken(undefined, token), false);
});
