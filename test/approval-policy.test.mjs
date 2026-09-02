import assert from "node:assert/strict";
import test from "node:test";
import { reviewServerRequest } from "../lib/approval-policy.mjs";

function request(method, params) {
  return { id: 7, method, params: { threadId: "thread-1", ...params } };
}

test("command arrays preserve boundaries and visible control characters", () => {
  const review = reviewServerRequest(
    request("execCommandApproval", {
      command: ["touch", "file with spaces\u202e"],
      cwd: "/workspace",
    }),
  );
  assert.equal(review.canAccept, true);
  assert.match(review.details.join("\n"), /\[1\] "file with spaces\\\\u202e"/);
});

test("network commands require an exact protocol and host", () => {
  const base = { command: "curl https://example.com", cwd: "/workspace" };
  assert.equal(
    reviewServerRequest(request("item/commandExecution/requestApproval", {
      ...base,
      networkApprovalContext: { host: "example.com" },
    })).canAccept,
    false,
  );
  assert.equal(
    reviewServerRequest(request("item/commandExecution/requestApproval", {
      ...base,
      networkApprovalContext: { protocol: "https", host: "example.com" },
    })).canAccept,
    true,
  );
});

test("new file changes show the exact kind, path, move destination, and diff", () => {
  const review = reviewServerRequest(
    request("item/fileChange/requestApproval", { itemId: "item-1" }),
    {
      id: "item-1",
      type: "fileChange",
      changes: [
        {
          path: "old.js",
          kind: { type: "update", move_path: "new.js" },
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    },
  );
  assert.equal(review.canAccept, true);
  assert.match(review.details.join("\n"), /Action: update/);
  assert.match(review.details.join("\n"), /Move to: new\.js/);
  assert.match(review.details.join("\n"), /@@ -1 \+1 @@/);
});

test("session-wide roots and oversized details are decline-only", () => {
  assert.equal(
    reviewServerRequest(request("item/fileChange/requestApproval", { grantRoot: "/workspace" })).canAccept,
    false,
  );
  const review = reviewServerRequest(
    request("execCommandApproval", {
      command: ["echo", "x".repeat(70 * 1024)],
      cwd: "/workspace",
    }),
  );
  assert.equal(review.canAccept, false);
  assert.match(review.details[0], /too large/);
});

test("unknown and connector requests remain decline-only", () => {
  assert.equal(reviewServerRequest(request("unknown", {})).canAccept, false);
  assert.equal(
    reviewServerRequest(request("mcpServer/elicitation/request", { url: "https://example.com" })).canAccept,
    false,
  );
});
