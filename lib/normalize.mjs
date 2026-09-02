import path from "node:path";

export function threadTitle(thread) {
  const raw = String(thread.name || thread.preview || "").trim();
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = (firstLine || "New Codex chat")
    .replace(/^#+\s*/, "")
    .replace(/^\[\d+\]\s*user:\s*/i, "");
  return title.length > 120 ? `${title.slice(0, 117)}…` : title;
}

export function normalizeThread(thread, placement = null) {
  return {
    id: thread.id,
    title: threadTitle(thread),
    cwd: String(thread.cwd || ""),
    folder: path.basename(String(thread.cwd || "")) || "No folder",
    updatedAt: thread.updatedAt ?? thread.createdAt ?? 0,
    status: thread.status?.type ?? "notLoaded",
    column: placement?.column ?? "backlog",
    order: placement?.order ?? 0,
  };
}

export function normalizeConversation(thread) {
  const messages = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const normalized = normalizeItem(item, turn.id);
      if (normalized) messages.push(normalized);
    }
  }
  return {
    thread: normalizeThread(thread),
    messages,
  };
}

function fileChangeDetail(changes = []) {
  return changes
    .map((change) => {
      const kind = change.kind?.type || change.kind;
      const heading = [kind, change.path].filter(Boolean).join(": ");
      const movePath = change.kind?.move_path ? `Move to: ${change.kind.move_path}` : null;
      return [heading, movePath, change.diff].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function userText(content = []) {
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "localImage" || part.type === "localAudio") return `[${part.type}: ${part.path}]`;
      if (part.type === "image" || part.type === "audio") return `[${part.type}]`;
      if (part.type === "skill") return `[$${part.name}]`;
      if (part.type === "mention") return `[@${part.name}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeItem(item, turnId = null) {
  if (!item || typeof item !== "object") return null;
  const base = { id: item.id, turnId };

  switch (item.type) {
    case "userMessage":
      return {
        ...base,
        type: "message",
        role: "user",
        text: userText(item.content),
        clientId: item.clientId ?? null,
      };
    case "agentMessage":
      return { ...base, type: "message", role: "assistant", text: item.text || "" };
    case "commandExecution":
      return {
        ...base,
        type: "activity",
        label: item.status === "inProgress" ? "Running command" : "Command",
        detail: item.command || "",
        status: item.status,
      };
    case "fileChange":
      return {
        ...base,
        type: "activity",
        label: "File changes",
        detail: fileChangeDetail(item.changes),
        status: item.status,
      };
    case "mcpToolCall":
      return {
        ...base,
        type: "activity",
        label: `${item.server}: ${item.tool}`,
        detail: "Tool call",
        status: item.status,
      };
    case "webSearch":
      return { ...base, type: "activity", label: "Web search", detail: item.query || "" };
    case "contextCompaction":
      return { ...base, type: "activity", label: "Context compacted", detail: "" };
    case "plan":
      return { ...base, type: "activity", label: "Plan", detail: item.text || "" };
    default:
      return null;
  }
}
