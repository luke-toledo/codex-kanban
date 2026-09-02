import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalMutation,
  assertLocalRequest,
  isAllowedHost,
  isAllowedOrigin,
} from "../lib/http-security.mjs";

const PORT = 4173;

function request({ host = "127.0.0.1:4173", origin, remoteAddress = "127.0.0.1", fetchSite } = {}) {
  return {
    headers: {
      host,
      origin,
      "content-type": "application/json",
      "sec-fetch-site": fetchSite,
    },
    socket: { remoteAddress },
  };
}

test("only the exact local Host and port are accepted", () => {
  assert.equal(isAllowedHost("127.0.0.1:4173", PORT), true);
  assert.equal(isAllowedHost("localhost:4173", PORT), false);
  assert.equal(isAllowedHost("attacker.example:4173", PORT), false);
  assert.equal(isAllowedHost("127.0.0.1:9999", PORT), false);
  assert.equal(isAllowedHost("localhost.:4173", PORT), false);
});

test("origin must exactly match the request host", () => {
  assert.equal(isAllowedOrigin("http://127.0.0.1:4173", "127.0.0.1:4173", PORT), true);
  assert.equal(isAllowedOrigin("http://localhost:4173", "127.0.0.1:4173", PORT), false);
  assert.equal(isAllowedOrigin("https://127.0.0.1:4173", "127.0.0.1:4173", PORT), false);
  assert.equal(isAllowedOrigin("http://user@127.0.0.1:4173", "127.0.0.1:4173", PORT), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4173/path", "127.0.0.1:4173", PORT), false);
  assert.equal(isAllowedOrigin("http://attacker.example:4173", "attacker.example:4173", PORT), false);
  assert.equal(isAllowedOrigin(undefined, "127.0.0.1:4173", PORT), false);
});

test("all requests reject remote addresses and cross-site browser traffic", () => {
  assert.doesNotThrow(() => assertLocalRequest(request({ fetchSite: "same-origin" }), PORT));
  assert.throws(
    () => assertLocalRequest(request({ remoteAddress: "192.0.2.10" }), PORT),
    /Only local connections/,
  );
  assert.throws(
    () => assertLocalRequest(request({ fetchSite: "cross-site" }), PORT),
    /Cross-site request blocked/,
  );
});

test("mutations require JSON and a matching origin", () => {
  const valid = request({ origin: "http://127.0.0.1:4173" });
  assert.doesNotThrow(() => assertLocalMutation(valid, PORT));
  assert.throws(
    () => assertLocalMutation({ ...valid, headers: { ...valid.headers, "content-type": "text/plain" } }, PORT),
    /Content-Type/,
  );
  assert.throws(
    () => assertLocalMutation(request({ origin: "http://attacker.example:4173" }), PORT),
    /Cross-origin/,
  );
});
