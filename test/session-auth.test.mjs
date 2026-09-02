import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionCookie,
  createSessionToken,
  hasValidSession,
  isValidBootstrapToken,
} from "../lib/session-auth.mjs";

test("creates an unguessable URL-safe session token", () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test("accepts only the exact launch token and matching cookie", () => {
  const token = "a".repeat(43);
  assert.equal(isValidBootstrapToken(token, token), true);
  assert.equal(isValidBootstrapToken(`${token}x`, token), false);
  assert.equal(hasValidSession(`other=x; codex_kanban_session=${token}`, token), true);
  assert.equal(hasValidSession("codex_kanban_session=wrong", token), false);
});

test("session cookie is browser-only and same-site", () => {
  const cookie = createSessionCookie("token");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});
