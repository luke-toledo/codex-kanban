# Security

## Supported use

Codex Kanban is a local, single-user interface for a Codex CLI session on the same computer. The supported address is `http://127.0.0.1:4173`.

Do not put it behind a tunnel, reverse proxy, public hostname, LAN address, container port, or hosted service. Remote and multi-user operation would require authentication, TLS, authorization, tenant isolation, rate limiting, and a different deployment design.

## Access and data

The app can:

- list and read native Codex chats;
- create chats and send prompts;
- stream selected Codex events;
- answer approval requests only when the server can verify that the browser is showing the exact bounded action.

It stores only Codex chat IDs and Kanban placement in the operating system's user-state directory. It does not store transcripts, credentials, or approval history and does not write to the Codex database.

## Built-in boundaries

- fixed IPv4 loopback binding;
- a fresh random launch token exchanged for an HttpOnly, SameSite browser cookie;
- exact loopback Host and same-origin mutation checks;
- cross-site request rejection, no CORS, restrictive CSP, and no response caching;
- allowlisted and normalized browser event payloads with size, connection, and backpressure limits;
- JSON request size limits;
- server-side approval eligibility checks;
- turn-only permission grants;
- decline-only handling for session-wide writes, missing or oversized details, unknown requests, and MCP forms or URLs;
- private, atomic board-state writes.

These controls reduce local web attacks and accidental exposure. They do not turn the project into a safe network service.

## Reporting a vulnerability

Please use the repository's private GitHub security-advisory form. Do not include credentials, private chat content, or other user data in a public issue.
