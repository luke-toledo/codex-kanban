import os from "node:os";
import path from "node:path";

const APP_DIRECTORY = "codex-kanban";

export function getBoardStatePath({
  platform = process.platform,
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  if (env.CODEX_KANBAN_STATE_DIR) {
    return path.resolve(env.CODEX_KANBAN_STATE_DIR, "board.json");
  }

  if (platform === "win32") {
    const baseDirectory =
      env.APPDATA || path.win32.join(homeDirectory, "AppData", "Roaming");
    return path.win32.join(baseDirectory, APP_DIRECTORY, "board.json");
  }

  if (platform === "darwin") {
    return path.posix.join(
      homeDirectory,
      "Library",
      "Application Support",
      APP_DIRECTORY,
      "board.json",
    );
  }

  const baseDirectory =
    env.XDG_STATE_HOME || path.posix.join(homeDirectory, ".local", "state");
  return path.posix.join(baseDirectory, APP_DIRECTORY, "board.json");
}
