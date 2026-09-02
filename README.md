# Codex Kanban

An unofficial, local-only Kanban board for native Codex chats. Drag chats between Backlog, To do, In progress, Review, and Done, inspect what is happening, then jump to the exact conversation in Codex when you need to work.

Your Codex installation keeps the conversations. Codex Kanban stores only each chat ID, column, and order.

Codex chats are deliberately read-only here. The app cannot create chats, send messages, answer questions, or approve actions. Its only write is your Kanban placement.

The ↗ action on every card and the link below every conversation preview open that exact chat in the Codex desktop app.

## Quick start

You need:

- macOS (currently tested; Windows and Linux are unverified)
- Node.js 20 or newer
- the [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) installed and signed in

From the folder where you normally work, run:

```sh
npx --yes github:luke-toledo/codex-kanban
```

The browser opens automatically at <http://127.0.0.1:4173>. Press `Ctrl+C` in the terminal to stop it. Start it again with the same command; your board order remains.

## Fork it

Fork the repository on GitHub, then substitute your username:

```sh
npx --yes github:YOUR_GITHUB_USERNAME/codex-kanban
```

No dependency installation, account, database, or cloud deployment is required beyond your existing Codex sign-in.

For local development:

```sh
git clone https://github.com/luke-toledo/codex-kanban.git
cd codex-kanban
npm start
```

## Persistence

Every move is saved before the UI reports success. Writes are serialized and atomic, so rapid moves and interrupted shutdowns cannot leave a partial board file.

State lives outside the repository and survives restarts, upgrades, new clones, and `npx` cache cleanup:

- macOS: `~/Library/Application Support/codex-kanban/board.json`
- Linux: `~/.local/state/codex-kanban/board.json` (or `$XDG_STATE_HOME`)
- Windows: `%APPDATA%\\codex-kanban\\board.json`

Existing installs automatically copy the old `data/board.json` layout once. The legacy file is left untouched as a backup.

## Security model

This is a trusted, single-user desktop tool—not a hosted web application.

- It binds only to `127.0.0.1` and rejects untrusted Host, Origin, and cross-site requests.
- Every launch creates a private browser session protected by a random token.
- It does not enable CORS or expose the Codex App Server over the network.
- Browser events are allowlisted and stripped to the fields the UI needs.
- Outgoing Codex requests are allowlisted to initialization, task listing, and task reading. Unexpected action requests fail closed.

Do **not** expose it with a tunnel, reverse proxy, LAN binding, container port, or public deployment. The local API can read your Codex chat content and update Kanban placement. It intentionally has no remote-user authentication or isolation.

See [SECURITY.md](SECURITY.md) for the complete boundary.

## How it works

The Node server starts `codex app-server --stdio` as a child process. It uses the signed-in Codex CLI only to list and read task history and observe status updates. It cannot create or modify Codex work and never edits the Codex database directly.

Card links use the [official Codex deep-link format](https://learn.chatgpt.com/docs/reference/commands#deep-links). A newly created chat may require reopening Codex before the desktop app notices it.

Codex App Server is currently experimental. This release is tested with `codex-cli 0.150.1`, so a future CLI protocol change may require an update.

## Development

```sh
npm test
```

The optional live check lists your tasks and reads one existing task without creating or changing anything:

```sh
npm run test:live
```
