import { codexThreadUrl } from "./deep-link.js";

const COLUMNS = ["backlog", "todo", "in-progress", "review", "done"];
const SESSION_KEY = "codex-kanban-session";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const launchToken = new URLSearchParams(location.search).get("token");
let sessionToken = null;
if (SESSION_TOKEN_PATTERN.test(launchToken || "")) {
  sessionToken = launchToken;
  try {
    sessionStorage.setItem(SESSION_KEY, sessionToken);
  } catch {
    // The current page can still use the launch token when storage is disabled.
  }
  history.replaceState(history.state, "", `${location.pathname}${location.hash}`);
} else {
  try {
    const storedToken = sessionStorage.getItem(SESSION_KEY);
    if (SESSION_TOKEN_PATTERN.test(storedToken || "")) sessionToken = storedToken;
  } catch {
    // The recovery screen below explains how to open a fresh private session.
  }
}

const state = {
  threads: [],
  messages: [],
  showHidden: false,
  activeThreadId: null,
  draggedId: null,
  suppressCardClick: false,
  loadingConversation: false,
  conversationError: null,
  returnFocusElement: null,
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  sessionRequired: document.querySelector("#sessionRequired"),
  boardSummary: document.querySelector("#boardSummary"),
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionLabel: document.querySelector("#connectionLabel"),
  hiddenToggleButton: document.querySelector("#hiddenToggleButton"),
  hiddenToggleLabel: document.querySelector("#hiddenToggleLabel"),
  hiddenCount: document.querySelector("#hiddenCount"),
  refreshButton: document.querySelector("#refreshButton"),
  chatLayer: document.querySelector("#chatLayer"),
  chatBackdrop: document.querySelector("#chatBackdrop"),
  closeChatButton: document.querySelector("#closeChatButton"),
  chatTitle: document.querySelector("#chatTitle"),
  chatFolder: document.querySelector("#chatFolder"),
  chatStatus: document.querySelector("#chatStatus"),
  messageScroll: document.querySelector("#messageScroll"),
  messageList: document.querySelector("#messageList"),
  editInCodexLink: document.querySelector("#editInCodexLink"),
  toast: document.querySelector("#toast"),
};

const columnLists = new Map(
  COLUMNS.map((column) => [column, document.querySelector(`[data-list="${column}"]`)]),
);

let toastTimer = null;
let eventSource = null;

async function api(url, options = {}) {
  if (!url.startsWith("/api/")) throw new Error("Only local API requests are allowed");
  if (!sessionToken) throw new Error("Restart Codex Kanban to open a private browser session");
  const requestOptions = { ...options };
  requestOptions.headers = {
    ...requestOptions.headers,
    "X-Codex-Kanban-Token": sessionToken,
  };
  if (requestOptions.body && typeof requestOptions.body !== "string") {
    requestOptions.headers = { ...requestOptions.headers, "Content-Type": "application/json" };
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  const response = await fetch(url, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) showSessionRequired();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showSessionRequired() {
  eventSource?.close();
  eventSource = null;
  state.activeThreadId = null;
  state.messages = [];
  state.loadingConversation = false;
  state.conversationError = null;
  state.returnFocusElement = null;
  elements.messageList.replaceChildren();
  elements.chatTitle.textContent = "Conversation";
  elements.chatFolder.textContent = "";
  elements.chatStatus.textContent = "Unknown";
  elements.chatStatus.className = "chat-status unknown";
  elements.chatStatus.title = "";
  elements.chatLayer.classList.remove("open");
  elements.chatLayer.setAttribute("aria-hidden", "true");
  elements.appShell.inert = false;
  elements.appShell.hidden = true;
  elements.sessionRequired.hidden = false;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function makeIcon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");

  const shapes = {
    external: [
      ["path", { d: "M8 16 16 8M9 8h7v7" }],
    ],
    hide: [
      ["path", { d: "M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" }],
      ["circle", { cx: "12", cy: "12", r: "2.5" }],
      ["path", { d: "m4 4 16 16" }],
    ],
    show: [
      ["path", { d: "M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" }],
      ["circle", { cx: "12", cy: "12", r: "2.5" }],
    ],
  };

  for (const [tag, attributes] of shapes[name]) {
    const shape = document.createElementNS(namespace, tag);
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", "currentColor");
    shape.setAttribute("stroke-width", tag === "circle" ? "1.7" : "1.8");
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("stroke-linejoin", "round");
    svg.append(shape);
  }
  return svg;
}

function setConnection(label, status = "ready") {
  elements.connectionLabel.textContent = label;
  elements.connectionStatus.dataset.state = status;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3_000);
}

function relativeTime(timestampSeconds) {
  if (!timestampSeconds) return "";
  const seconds = timestampSeconds - Math.floor(Date.now() / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function activeThread() {
  return state.threads.find((thread) => thread.id === state.activeThreadId) ?? null;
}

function renderBoard() {
  const hiddenTotal = state.threads.filter((thread) => thread.hidden).length;
  if (hiddenTotal === 0) state.showHidden = false;
  elements.hiddenToggleButton.disabled = hiddenTotal === 0;
  elements.hiddenToggleButton.setAttribute("aria-pressed", String(state.showHidden));
  elements.hiddenToggleButton.setAttribute(
    "aria-label",
    state.showHidden ? "Hide hidden tasks" : `Show ${hiddenTotal} hidden tasks`,
  );
  elements.hiddenToggleLabel.textContent = state.showHidden ? "Hide hidden" : "Show hidden";
  elements.hiddenCount.textContent = String(hiddenTotal);
  elements.hiddenCount.hidden = hiddenTotal === 0;

  for (const column of COLUMNS) {
    const list = columnLists.get(column);
    list.replaceChildren();
    const columnThreads = state.threads
      .filter((thread) => thread.column === column)
      .sort((left, right) => left.order - right.order);
    const threads = columnThreads.filter((thread) => !thread.hidden || state.showHidden);
    document.querySelector(`[data-count="${column}"]`).textContent = String(threads.length);

    if (threads.length === 0) {
      list.append(
        makeElement("div", "empty-column", columnThreads.length ? "No visible chats" : "Drop chats here"),
      );
      continue;
    }

    for (const thread of threads) list.append(createTaskCard(thread));
  }
  elements.boardSummary.textContent = hiddenTotal
    ? state.showHidden
      ? `${state.threads.length} Codex tasks · ${hiddenTotal} hidden shown`
      : `${state.threads.length - hiddenTotal} visible · ${hiddenTotal} hidden`
    : `${state.threads.length} Codex tasks · drag to organize`;
}

function createTaskCard(thread) {
  const card = makeElement("article", "task-card");
  card.classList.toggle("is-hidden", thread.hidden);
  card.dataset.threadId = thread.id;
  card.draggable = true;

  const heading = makeElement("div", "card-heading");
  const previewButton = makeElement("button", "card-preview-button");
  previewButton.type = "button";
  previewButton.dataset.cardAction = "true";
  previewButton.draggable = false;
  previewButton.setAttribute("aria-label", `Preview ${thread.title}`);
  previewButton.append(makeElement("span", "card-title", thread.title));
  previewButton.addEventListener("click", () => openThread(thread.id));
  heading.append(previewButton);

  const actions = makeElement("div", "card-actions");
  const hideButton = makeElement("button", "card-action card-hide-button");
  hideButton.type = "button";
  hideButton.dataset.cardAction = "true";
  hideButton.draggable = false;
  hideButton.title = thread.hidden ? "Show task" : "Hide task";
  hideButton.setAttribute("aria-label", `${thread.hidden ? "Show" : "Hide"} ${thread.title}`);
  hideButton.append(makeIcon(thread.hidden ? "show" : "hide"));
  hideButton.addEventListener("click", () => setThreadHidden(thread.id, !thread.hidden));
  actions.append(hideButton);

  const codexLink = makeElement("a", "card-action card-codex-link");
  codexLink.href = codexThreadUrl(thread.id);
  codexLink.title = "Open in Codex";
  codexLink.setAttribute("aria-label", `Open ${thread.title} in Codex`);
  codexLink.dataset.cardAction = "true";
  codexLink.draggable = false;
  codexLink.append(makeIcon("external"));
  actions.append(codexLink);
  heading.append(actions);
  card.append(heading);

  const meta = makeElement("div", "card-meta");
  const folder = makeElement("span", "card-folder", thread.folder);
  folder.title = thread.cwd;
  meta.append(folder);

  if (thread.hidden) {
    meta.append(makeElement("span", "card-hidden-label", "Hidden"));
  } else if (thread.status === "active") {
    meta.append(makeElement("span", "card-state", "Working"));
  } else {
    meta.append(makeElement("time", "", relativeTime(thread.updatedAt)));
  }
  card.append(meta);

  card.addEventListener("click", (event) => {
    if (event.target.closest("[data-card-action]")) return;
    if (!state.suppressCardClick) openThread(thread.id);
  });
  card.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest(".card-actions")) {
      event.preventDefault();
      return;
    }
    state.draggedId = thread.id;
    state.suppressCardClick = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", thread.id);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    for (const list of columnLists.values()) list.classList.remove("drag-over");
    state.draggedId = null;
    setTimeout(() => {
      state.suppressCardClick = false;
    }, 0);
  });
  return card;
}

function setThreadHidden(threadId, hidden) {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  thread.hidden = hidden;
  renderBoard();
  elements.hiddenToggleButton.focus();
  showToast(hidden ? "Task hidden" : "Task shown");
  persistBoard();
}

function moveCard(threadId, column, beforeThreadId = null) {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread || !COLUMNS.includes(column)) return;

  const buckets = Object.fromEntries(COLUMNS.map((key) => [key, []]));
  for (const candidate of [...state.threads].sort((left, right) => left.order - right.order)) {
    if (candidate.id !== threadId) buckets[candidate.column].push(candidate);
  }

  const destination = buckets[column];
  const targetIndex = beforeThreadId
    ? destination.findIndex((candidate) => candidate.id === beforeThreadId)
    : -1;
  destination.splice(targetIndex >= 0 ? targetIndex : destination.length, 0, thread);

  for (const key of COLUMNS) {
    buckets[key].forEach((candidate, order) => {
      candidate.column = key;
      candidate.order = order;
    });
  }
  renderBoard();
  persistBoard();
}

async function persistBoard() {
  try {
    await api("/api/board", {
      method: "PUT",
      body: {
        cards: state.threads.map(({ id, column, order, hidden }) => ({
          threadId: id,
          column,
          order,
          hidden: hidden === true,
        })),
      },
    });
  } catch (error) {
    showToast(`Could not save placement: ${error.message}`);
    await loadThreads({ silent: true });
  }
}

async function loadThreads({ silent = false } = {}) {
  if (!silent) elements.refreshButton.classList.add("is-loading");
  try {
    const result = await api("/api/threads");
    state.threads = result.threads;
    renderBoard();
    updateChatHeader();
    setConnection("Connected", "ready");
  } catch (error) {
    setConnection("Disconnected", "error");
    showToast(error.message);
  } finally {
    elements.refreshButton.classList.remove("is-loading");
  }
}

function updateChatHeader() {
  const thread = activeThread();
  if (!thread) return;
  elements.chatTitle.textContent = thread.title;
  elements.chatFolder.textContent = thread.cwd;
  const statuses = {
    active: { label: "Working", tone: "working", title: "This local Codex session is working" },
    idle: { label: "Idle", tone: "idle", title: "This local Codex session is idle" },
    systemError: { label: "Error", tone: "error", title: "Codex reported an error" },
  };
  const status = statuses[thread.status] ?? {
    label: "Unknown",
    tone: "unknown",
    title: "Codex Desktop does not expose live status to this read-only view",
  };
  elements.chatStatus.textContent = status.label;
  elements.chatStatus.className = `chat-status ${status.tone}`;
  elements.chatStatus.title = status.title;
  elements.editInCodexLink.href = codexThreadUrl(thread.id);
  elements.editInCodexLink.setAttribute("aria-label", `Edit ${thread.title} in Codex`);
}

async function openThread(threadId, { updateHistory = true } = {}) {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  if (!elements.chatLayer.classList.contains("open")) {
    state.returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  state.activeThreadId = threadId;
  state.messages = [];
  state.loadingConversation = true;
  state.conversationError = null;
  elements.chatLayer.classList.add("open");
  elements.chatLayer.setAttribute("aria-hidden", "false");
  elements.appShell.inert = true;
  updateChatHeader();
  renderMessages();
  if (updateHistory) history.pushState({ threadId }, "", `#${encodeURIComponent(threadId)}`);

  try {
    const result = await api(`/api/threads/${encodeURIComponent(threadId)}`);
    if (state.activeThreadId !== threadId) return;
    state.messages = result.messages;
  } catch (error) {
    state.conversationError = error.message;
    showToast(`Could not open chat: ${error.message}`);
  } finally {
    if (state.activeThreadId === threadId) {
      state.loadingConversation = false;
      renderMessages({ forceBottom: true });
      elements.closeChatButton.focus();
    }
  }
}

function closeThread({ updateHistory = true } = {}) {
  state.activeThreadId = null;
  state.messages = [];
  state.conversationError = null;
  elements.chatLayer.classList.remove("open");
  elements.chatLayer.setAttribute("aria-hidden", "true");
  elements.appShell.inert = false;
  if (updateHistory) history.pushState({}, "", `${location.pathname}${location.search}`);
  if (state.returnFocusElement?.isConnected) state.returnFocusElement.focus();
  state.returnFocusElement = null;
}

function renderMessages({ forceBottom = false } = {}) {
  const shouldStick =
    forceBottom ||
    elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight < 100;
  elements.messageList.replaceChildren();

  if (state.loadingConversation) {
    elements.messageList.append(makeElement("div", "conversation-loading", "Loading conversation…"));
  } else if (state.conversationError) {
    elements.messageList.append(makeElement("div", "conversation-empty", "Could not load this conversation."));
  } else if (state.messages.length === 0) {
    elements.messageList.append(makeElement("div", "conversation-empty", "No messages yet."));
  } else {
    for (const message of state.messages) {
      if (message.type === "message") {
        const row = makeElement("div", `message-row ${message.role}${message.streaming ? " streaming" : ""}`);
        row.dataset.itemId = message.id;
        row.append(makeElement("div", "message-bubble", message.text || " "));
        elements.messageList.append(row);
      } else if (message.type === "activity") {
        const row = makeElement("div", "activity-row");
        const details = document.createElement("details");
        details.append(makeElement("summary", "", message.label));
        if (message.detail) details.append(makeElement("pre", "", message.detail));
        row.append(details);
        elements.messageList.append(row);
      }
    }
  }

  if (shouldStick) {
    requestAnimationFrame(() => {
      elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight;
    });
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(sessionToken)}`);
  eventSource.onopen = () => setConnection("Connected", "ready");
  eventSource.onerror = () => setConnection("Reconnecting", "loading");
  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "connected") return;
    if (payload.type === "fatal") {
      setConnection("Codex stopped", "error");
      showToast(payload.message);
      return;
    }
    if (payload.type === "refresh") {
      loadThreads({ silent: true });
      if (state.activeThreadId) loadConversationAfterTurn(state.activeThreadId);
      return;
    }
    if (payload.type !== "codex") return;
    handleCodexEvent(payload.message);
  };
}

function handleCodexEvent(message) {
  const params = message.params || {};
  const isActive = params.threadId === state.activeThreadId;

  if (message.method === "turn/started") {
    const thread = state.threads.find((candidate) => candidate.id === params.threadId);
    if (thread) thread.status = "active";
    if (isActive) updateChatHeader();
    renderBoard();
    return;
  }
  if (message.method === "turn/completed") {
    const thread = state.threads.find((candidate) => candidate.id === params.threadId);
    if (thread) thread.status = "idle";
    if (isActive) {
      updateChatHeader();
      loadConversationAfterTurn(params.threadId);
    }
    loadThreads({ silent: true });
    return;
  }
  if (message.method === "thread/status/changed") {
    const thread = state.threads.find((candidate) => candidate.id === params.threadId);
    if (thread) thread.status = params.status?.type || thread.status;
    updateChatHeader();
    renderBoard();
    return;
  }
  if (["thread/started", "thread/name/updated", "thread/archived", "thread/unarchived"].includes(message.method)) {
    loadThreads({ silent: true });
    return;
  }
  if (message.method === "error") {
    showToast(params.message || "Codex reported an error");
  }
}

async function loadConversationAfterTurn(threadId) {
  try {
    const result = await api(`/api/threads/${encodeURIComponent(threadId)}`);
    if (state.activeThreadId !== threadId) return;
    state.messages = result.messages;
    renderMessages({ forceBottom: true });
  } catch (error) {
    showToast(`Could not refresh chat: ${error.message}`);
  }
}

for (const [column, list] of columnLists) {
  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    list.classList.add("drag-over");
  });
  list.addEventListener("dragleave", (event) => {
    if (!list.contains(event.relatedTarget)) list.classList.remove("drag-over");
  });
  list.addEventListener("drop", (event) => {
    event.preventDefault();
    list.classList.remove("drag-over");
    const draggedId = state.draggedId || event.dataTransfer.getData("text/plain");
    const target = event.target instanceof Element ? event.target.closest(".task-card") : null;
    let beforeId = target?.dataset.threadId || null;
    if (target && event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2) {
      beforeId = target.nextElementSibling?.dataset?.threadId || null;
    }
    if (beforeId === draggedId) return;
    moveCard(draggedId, column, beforeId);
  });
}

elements.refreshButton.addEventListener("click", () => loadThreads());
elements.hiddenToggleButton.addEventListener("click", () => {
  state.showHidden = !state.showHidden;
  renderBoard();
});
elements.closeChatButton.addEventListener("click", () => closeThread());
elements.chatBackdrop.addEventListener("click", () => closeThread());

function threadIdFromHash() {
  try {
    return decodeURIComponent(location.hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

window.addEventListener("popstate", () => {
  const threadId = threadIdFromHash();
  if (threadId) openThread(threadId, { updateHistory: false });
  else closeThread({ updateHistory: false });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.activeThreadId) closeThread();
});

async function initialize() {
  if (!sessionToken) {
    showSessionRequired();
    return;
  }
  try {
    const health = await api("/api/health");
    setConnection(health.ok ? "Connected" : "Starting", health.ok ? "ready" : "loading");
  } catch {
    setConnection("Disconnected", "error");
    if (!elements.sessionRequired.hidden) return;
  }
  connectEvents();
  await loadThreads();
  const initialThreadId = threadIdFromHash();
  if (initialThreadId && state.threads.some((thread) => thread.id === initialThreadId)) {
    openThread(initialThreadId, { updateHistory: false });
  }
}

initialize();
