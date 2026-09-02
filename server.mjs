#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoardStore } from "./lib/board-store.mjs";
import { CodexClient } from "./lib/codex-client.mjs";
import { assertLocalMutation, assertLocalRequest, HttpError } from "./lib/http-security.mjs";
import { normalizeConversation, normalizeThread } from "./lib/normalize.mjs";
import { publicCodexNotification } from "./lib/public-events.mjs";
import {
  createSessionCookie,
  createSessionToken,
  hasValidSession,
  isValidBootstrapToken,
} from "./lib/session-auth.mjs";
import { getBoardStatePath } from "./lib/state-path.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.CODEX_KANBAN_PORT || "4173", 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("CODEX_KANBAN_PORT must be a number between 1 and 65535");
}
const ORIGIN = `http://${HOST}:${PORT}`;
const MAX_EVENT_CLIENTS = 8;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENT_CLIENT_BUFFER = 256 * 1024;
const sessionToken = createSessionToken();
const board = new BoardStore(getBoardStatePath(), {
  legacyFilePath: path.join(ROOT, "data", "board.json"),
});
const codex = new CodexClient();
const eventClients = new Set();

await board.load();
await codex.start();

codex.on("notification", (message) => {
  const publicMessage = publicCodexNotification(message);
  if (publicMessage) broadcast({ type: "codex", message: publicMessage });
});
codex.on("fatal", (error) => broadcast({ type: "fatal", message: error.message }));

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    assertLocalRequest(request, PORT);
    const url = new URL(request.url, ORIGIN);

    if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      if (!isValidBootstrapToken(url.searchParams.get("token"), sessionToken)) {
        return json(response, 401, { error: "Invalid session link" });
      }
      response.writeHead(303, {
        "Cache-Control": "no-store",
        Location: "/",
        "Set-Cookie": createSessionCookie(sessionToken),
      });
      return response.end();
    }

    if (!hasValidSession(request.headers.cookie, sessionToken)) {
      return json(response, 401, { error: "Restart Codex Kanban to open a private browser session" });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: codex.ready });
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      if (eventClients.size >= MAX_EVENT_CLIENTS) {
        throw new HttpError(503, "Too many open browser connections");
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      eventClients.add(response);
      const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 20_000);
      const cleanup = () => {
        clearInterval(keepAlive);
        eventClients.delete(response);
      };
      request.on("close", cleanup);
      response.on("error", cleanup);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/threads") {
      const threads = await codex.listThreads();
      await board.syncThreadIds(threads.map((thread) => thread.id));
      return json(response, 200, {
        threads: threads.map((thread) => normalizeThread(thread, board.get(thread.id))),
      });
    }

    if (request.method === "PUT" && url.pathname === "/api/board") {
      assertLocalMutation(request, PORT);
      const body = await readJson(request);
      const cards = await board.update(body.cards);
      return json(response, 200, { cards });
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9-]+)$/);
    if (request.method === "GET" && threadMatch) {
      const result = await codex.readThread(threadMatch[1]);
      return json(response, 200, normalizeConversation(result.thread));
    }

    if (request.method === "GET") return serveStatic(url.pathname, response);
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return json(response, status, { error: error.message || "Unexpected error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Kanban is running at ${ORIGIN}`);
  console.log("Board placement is saved automatically and survives restarts.");
  const launchUrl = `${ORIGIN}/?token=${sessionToken}`;
  if (process.env.CODEX_KANBAN_OPEN === "0") {
    console.log(`Open this private launch link: ${launchUrl}`);
  } else {
    openBrowser(launchUrl);
  }
});

server.on("error", (error) => {
  codex.stop();
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process or set CODEX_KANBAN_PORT.`);
  } else {
    console.error(error.message || error);
  }
  process.exitCode = 1;
});

function broadcast(payload) {
  let line = `data: ${JSON.stringify(payload)}\n\n`;
  if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
    line = `data: ${JSON.stringify({ type: "refresh" })}\n\n`;
  }
  const byteLength = Buffer.byteLength(line);
  for (const client of eventClients) {
    if (client.destroyed || client.writableEnded) {
      eventClients.delete(client);
      continue;
    }
    if (client.writableLength + byteLength > MAX_EVENT_CLIENT_BUFFER) {
      client.end();
      eventClients.delete(client);
      continue;
    }
    client.write(line);
  }
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 120_000) throw new Error("Request body is too large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function serveStatic(urlPath, response) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/deep-link.js": ["deep-link.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  if (urlPath === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  const selected = files[urlPath];
  if (!selected) return json(response, 404, { error: "Not found" });
  response.writeHead(200, { "Content-Type": selected[1], "Cache-Control": "no-cache" });
  createReadStream(path.join(PUBLIC_DIR, selected[0])).pipe(response);
}

function setSecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function openBrowser(url) {
  if (process.env.CODEX_KANBAN_OPEN === "0") return;
  const launch =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(launch[0], launch[1], { detached: true, stdio: "ignore" });
  child.on("error", () => console.error(`Could not open a browser. Visit ${url}`));
  child.unref();
}

function shutdown() {
  codex.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
