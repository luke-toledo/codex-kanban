# Security

## Supported use

Codex Kanban is a local, single-user interface for a Codex CLI session on the same trusted computer. The supported address is `http://127.0.0.1:4173`.

Do not put it behind a tunnel, reverse proxy, public hostname, LAN address, container port, or hosted service. Remote or multi-user operation would require authentication, TLS, authorization, tenant isolation, rate limiting, and a different deployment design.

## Data flow

At runtime, Kanban's own browser and Node code send no application data to an external service and contain no analytics or third-party browser assets. Its data path is:

1. the local Node process communicates with `codex app-server` over standard input/output;
2. the local browser communicates with Node over IPv4 loopback;
3. only task IDs, Kanban positions, and hidden flags are written to the board file.

The task list sends each task's title, working folder, update time, and status to the authenticated local browser. Opening a card additionally sends its normalized messages and visible activity, which can include commands, file paths, diffs, web-search queries, plans, and local media paths. API responses are not cached. The browser holds this content transiently; Codex Kanban does not persist it.

The persistent board file contains exactly `threadId`, `column`, `order`, and `hidden`. It contains no transcript or credential. All task IDs are added when the board syncs, including tasks the user has not manually moved.

This boundary does not cover the separately installed Codex app/CLI, Node.js, browser, operating system, or GitHub. Codex retains its normal OpenAI network and data behavior. `npx` contacts GitHub and executes the downloaded project source with the user's permissions.

## Built-in controls

- fixed IPv4 loopback binding;
- a fresh random 256-bit key for every launch;
- the key is held in server memory and the current tab's port-scoped session storage, not a cross-port localhost cookie;
- the launch URL is removed from the address bar after the tab stores the key;
- exact loopback Host checks, Fetch Metadata checks, and exact same-origin JSON mutations;
- no CORS, no private-response caching, restrictive CSP, `nosniff`, COOP, CORP, and no referrer;
- a static-file allowlist that prevents path traversal;
- normalized browser rendering through text nodes rather than HTML injection;
- allowlisted browser events with connection, event-size, and backpressure limits;
- byte-limited JSON requests and bounded, canonical board records;
- an outgoing App Server allowlist limited to initialization, task listing, and task reading;
- fail-closed handling for unexpected App Server action requests;
- serialized, atomic board-state writes with private file permissions where supported.

These controls reduce local web attacks and accidental exposure. They do not turn the project into a safe network service.

## Known limitations and risks

- Installed code is trusted code. A malicious repository or fork could ignore every application-level restriction and read data using the user's permissions. Review the source or pin a commit you trust.
- The private key appears briefly in the launch URL and in the local event-stream request. Do not share the URL, browser diagnostics, or terminal output. Stop and restart the app to invalidate the key.
- A browser extension, malicious same-user process, screen capture, or person using the unlocked browser session may see displayed content. This tool is not a sandbox against a compromised computer.
- Browser storage is scoped to the fixed `127.0.0.1:4173` origin. If that exact origin was previously used by untrusted software, clear its browser site data, including service workers, before running Kanban.
- Opening a conversation places its task ID—not its transcript—in the browser URL hash and possibly browser history.
- Run only one instance against a board file. Separate instances do not coordinate writes; the last successful write wins.
- A crash or power loss can lose the newest move, but the atomic write design prevents a partially written board file.
- An early repository-local `data/board.json` is left untouched after migration as a backup. It contains IDs and positions and may have its old permissions. Delete it manually after verifying the migrated board.
- The App Server protocol is experimental. Future Codex CLI changes may break compatibility or require another review.

## Review status

The source and a live fake-Codex HTTP boundary were reviewed on 2026-09-02. Tests cover session enforcement, exact Host and Origin checks, cross-site rejection, lack of CORS, CSP directives, request-size handling, malformed JSON, and static path traversal. No critical or high-severity finding was identified within the supported local, single-user threat model. This is an engineering review, not a formal independent penetration test.

## Reporting a vulnerability

Use the repository's private GitHub security-advisory form. Do not include credentials, private chat content, launch URLs, or other user data in a public issue.
