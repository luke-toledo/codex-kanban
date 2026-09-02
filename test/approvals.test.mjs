import assert from "node:assert/strict";
import test from "node:test";
import { buildServerResponse } from "../lib/codex-client.mjs";

test("MCP forms and URLs are declined instead of accepted with guessed content", () => {
  const request = {
    method: "mcpServer/elicitation/request",
    params: { mode: "url", url: "https://example.com/approve" },
  };
  assert.deepEqual(buildServerResponse(request, { action: "decline" }), { action: "decline" });
  assert.throws(
    () => buildServerResponse(request, { action: "accept" }),
    /cannot be accepted safely/,
  );
});

test("permission approval grants only the exact requested profile", () => {
  const permissions = {
    fileSystem: { write: ["/tmp/example"] },
    network: { enabled: false },
  };
  const request = {
    method: "item/permissions/requestApproval",
    params: { permissions },
  };
  assert.deepEqual(buildServerResponse(request, { action: "accept" }), {
    permissions,
    scope: "turn",
  });
  assert.deepEqual(buildServerResponse(request, { action: "accept", scope: "session" }), {
    permissions,
    scope: "turn",
  });
  assert.deepEqual(buildServerResponse(request, { action: "decline" }), {
    permissions: {},
    scope: "turn",
  });
});

test("a direct response cannot bypass file approval review", () => {
  const request = {
    method: "item/fileChange/requestApproval",
    params: { itemId: "change-1" },
  };
  assert.throws(
    () => buildServerResponse(request, { action: "accept" }),
    /cannot be accepted safely/,
  );

  const item = {
    id: "change-1",
    type: "fileChange",
    changes: [
      {
        path: "app.js",
        kind: { type: "update" },
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ],
  };
  assert.deepEqual(buildServerResponse(request, { action: "accept" }, { item }), {
    decision: "accept",
  });
});

test("session-wide write roots cannot be accepted from the Kanban", () => {
  const request = {
    method: "item/fileChange/requestApproval",
    params: { itemId: "change-1", grantRoot: "/workspace" },
  };
  assert.throws(
    () => buildServerResponse(request, { action: "accept" }),
    /cannot be accepted safely/,
  );
});
