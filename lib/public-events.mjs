import { normalizeItem } from "./normalize.mjs";

const THREAD_REFRESH_METHODS = new Set([
  "thread/started",
  "thread/name/updated",
  "thread/archived",
  "thread/unarchived",
]);

export function publicCodexNotification(message) {
  const params = message?.params || {};

  switch (message?.method) {
    case "item/agentMessage/delta":
      return {
        method: message.method,
        params: {
          threadId: params.threadId,
          turnId: params.turnId,
          itemId: params.itemId,
          delta: params.delta || "",
        },
      };
    case "item/started":
    case "item/completed": {
      const item = normalizeItem(params.item, params.turnId);
      if (!item) return null;
      return {
        method: message.method,
        params: { threadId: params.threadId, turnId: params.turnId, item },
      };
    }
    case "turn/started":
    case "turn/completed":
      return {
        method: message.method,
        params: { threadId: params.threadId, turnId: params.turnId },
      };
    case "thread/status/changed":
      return {
        method: message.method,
        params: { threadId: params.threadId, status: params.status },
      };
    case "error":
      return {
        method: message.method,
        params: {
          threadId: params.threadId,
          message: params.error?.message || params.message || "Codex reported an error",
        },
      };
    default:
      if (THREAD_REFRESH_METHODS.has(message?.method)) {
        return { method: message.method, params: { threadId: params.threadId } };
      }
      return null;
  }
}
