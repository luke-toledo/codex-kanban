const THREAD_REFRESH_METHODS = new Set([
  "thread/started",
  "thread/name/updated",
  "thread/archived",
  "thread/unarchived",
]);

export function publicCodexNotification(message) {
  const params = message?.params || {};

  switch (message?.method) {
    case "turn/started":
    case "turn/completed":
      return {
        method: message.method,
        params: { threadId: params.threadId },
      };
    case "thread/status/changed":
      return {
        method: message.method,
        params: { threadId: params.threadId, status: { type: params.status?.type } },
      };
    case "error":
      return {
        method: message.method,
        params: { message: "Codex reported an error" },
      };
    default:
      if (THREAD_REFRESH_METHODS.has(message?.method)) {
        return { method: message.method, params: { threadId: params.threadId } };
      }
      return null;
  }
}
