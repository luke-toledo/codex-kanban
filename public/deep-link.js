export function codexThreadUrl(threadId) {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new TypeError("A Codex thread ID is required");
  }
  return `codex://threads/${encodeURIComponent(threadId)}`;
}
