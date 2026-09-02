import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function request(port, { path: urlPath = "/", method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      { host: "127.0.0.1", port, path: urlPath, method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.once("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function requestStatus(port, urlPath) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({ host: "127.0.0.1", port, path: urlPath }, (response) => {
      resolve(response.statusCode);
      response.destroy();
    });
    outgoing.once("error", reject);
  });
}

async function startServer(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-kanban-server-"));
  const fakeCodex = path.join(directory, "codex");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id == null) return;
  const result = message.method === "thread/list" ? { data: [], nextCursor: null } : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
});
`,
    "utf8",
  );
  await chmod(fakeCodex, 0o755);

  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      CODEX_KANBAN_OPEN: "0",
      CODEX_KANBAN_PORT: String(port),
      CODEX_KANBAN_STATE_DIR: path.join(directory, "state"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const token = await new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/\?token=([A-Za-z0-9_-]{43})/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}: ${stderr}`));
    });
  });

  context.after(async () => {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(directory, { recursive: true, force: true });
  });

  return { port, token };
}

test("live HTTP boundary requires the port-scoped token and exact local origin", async (context) => {
  const { port, token } = await startServer(context);
  const host = `127.0.0.1:${port}`;
  const auth = { "X-Codex-Kanban-Token": token };

  const page = await request(port, { path: `/?token=${token}` });
  assert.equal(page.status, 200);
  assert.equal(page.headers["set-cookie"], undefined);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.headers["content-security-policy"], /object-src 'none'/);
  assert.match(page.headers["content-security-policy"], /form-action 'none'/);

  const cleanPage = await request(port);
  assert.equal(cleanPage.status, 200);
  assert.equal(cleanPage.headers["cache-control"], "no-store");
  assert.match(cleanPage.body, /Private session required/);

  const anonymous = await request(port, { path: "/api/health" });
  assert.equal(anonymous.status, 401);

  const legacyCookie = await request(port, {
    path: "/api/health",
    headers: { Cookie: `codex_kanban_session=${token}` },
  });
  assert.equal(legacyCookie.status, 401);

  const health = await request(port, { path: "/api/health", headers: auth });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });
  assert.equal(health.headers["access-control-allow-origin"], undefined);

  assert.equal(await requestStatus(port, `/api/events?token=${token}`), 200);
  assert.equal(await requestStatus(port, "/api/events?token=wrong"), 401);

  const wrongHost = await request(port, {
    path: "/api/health",
    headers: { ...auth, Host: `attacker.example:${port}` },
  });
  assert.equal(wrongHost.status, 403);

  const crossSite = await request(port, {
    path: "/api/health",
    headers: { ...auth, Host: host, "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(crossSite.status, 403);

  const missingOrigin = await request(port, {
    path: "/api/board",
    method: "PUT",
    headers: { ...auth, Host: host, "Content-Type": "application/json" },
    body: JSON.stringify({ cards: [] }),
  });
  assert.equal(missingOrigin.status, 403);

  const validMutationHeaders = {
    ...auth,
    Host: host,
    Origin: `http://${host}`,
    "Content-Type": "application/json",
  };
  const malformed = await request(port, {
    path: "/api/board",
    method: "PUT",
    headers: validMutationHeaders,
    body: "{",
  });
  assert.equal(malformed.status, 400);

  const oversized = await request(port, {
    path: "/api/board",
    method: "PUT",
    headers: validMutationHeaders,
    body: JSON.stringify({ cards: [], padding: "x".repeat(512 * 1024) }),
  });
  assert.equal(oversized.status, 413);

  const traversal = await request(port, {
    path: "/%2e%2e/package.json",
    headers: auth,
  });
  assert.equal(traversal.status, 404);
});
