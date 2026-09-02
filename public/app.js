import { codexThreadUrl } from "./deep-link.js";

const COLUMNS = ["backlog", "todo", "in-progress", "review", "done"];

const state = {
  threads: [],
  messages: [],
  requests: [],
  activeThreadId: null,
  draggedId: null,
  suppressCardClick: false,
  sending: false,
  loadingConversation: false,
  defaultCwd: "",
};

const elements = {
  boardSummary: document.querySelector("#boardSummary"),
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionLabel: document.querySelector("#connectionLabel"),
  refreshButton: document.querySelector("#refreshButton"),
  newChatButton: document.querySelector("#newChatButton"),
  chatLayer: document.querySelector("#chatLayer"),
  chatBackdrop: document.querySelector("#chatBackdrop"),
  closeChatButton: document.querySelector("#closeChatButton"),
  chatTitle: document.querySelector("#chatTitle"),
  chatFolder: document.querySelector("#chatFolder"),
  chatStatus: document.querySelector("#chatStatus"),
  messageScroll: document.querySelector("#messageScroll"),
  messageList: document.querySelector("#messageList"),
  requestList: document.querySelector("#requestList"),
  composerForm: document.querySelector("#composerForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  newChatDialog: document.querySelector("#newChatDialog"),
  newChatForm: document.querySelector("#newChatForm"),
  cwdInput: document.querySelector("#cwdInput"),
  knownFolders: document.querySelector("#knownFolders"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  cancelNewChatButton: document.querySelector("#cancelNewChatButton"),
  createChatButton: document.querySelector("#createChatButton"),
  newChatError: document.querySelector("#newChatError"),
  toast: document.querySelector("#toast"),
};

const columnLists = new Map(
  COLUMNS.map((column) => [column, document.querySelector(`[data-list="${column}"]`)]),
);

let toastTimer = null;

async function api(url, options = {}) {
  const requestOptions = { ...options };
  if (requestOptions.body && typeof requestOptions.body !== "string") {
    requestOptions.headers = { ...requestOptions.headers, "Content-Type": "application/json" };
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  const response = await fetch(url, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
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

function requestThreadId(request) {
  return request.params?.threadId || request.params?.conversationId || null;
}

function hasPendingRequest(threadId) {
  return state.requests.some((request) => requestThreadId(request) === threadId);
}

function renderBoard() {
  for (const column of COLUMNS) {
    const list = columnLists.get(column);
    list.replaceChildren();
    const threads = state.threads
      .filter((thread) => thread.column === column)
      .sort((left, right) => left.order - right.order);
    document.querySelector(`[data-count="${column}"]`).textContent = String(threads.length);

    if (threads.length === 0) {
      list.append(makeElement("div", "empty-column", "Drop chats here"));
      continue;
    }

    for (const thread of threads) list.append(createTaskCard(thread));
  }
  elements.boardSummary.textContent = `${state.threads.length} Codex tasks · drag to organize`;
}

function createTaskCard(thread) {
  const card = makeElement("article", "task-card");
  card.dataset.threadId = thread.id;
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${thread.title}`);

  const heading = makeElement("div", "card-heading");
  heading.append(makeElement("h3", "", thread.title));
  const codexLink = makeElement("a", "card-codex-link", "↗");
  codexLink.href = codexThreadUrl(thread.id);
  codexLink.title = "Open in Codex";
  codexLink.setAttribute("aria-label", `Open ${thread.title} in Codex`);
  codexLink.dataset.cardAction = "true";
  codexLink.draggable = false;
  heading.append(codexLink);
  card.append(heading);

  const meta = makeElement("div", "card-meta");
  const folder = makeElement("span", "card-folder", thread.folder);
  folder.title = thread.cwd;
  meta.append(folder);

  if (hasPendingRequest(thread.id)) {
    meta.append(makeElement("span", "card-state", "Needs input"));
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
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openThread(thread.id);
    }
  });
  card.addEventListener("dragstart", (event) => {
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
        cards: state.threads.map(({ id, column, order }) => ({ threadId: id, column, order })),
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
    updateKnownFolders();
    updateChatHeader();
    setConnection("Connected", "ready");
  } catch (error) {
    setConnection("Disconnected", "error");
    showToast(error.message);
  } finally {
    elements.refreshButton.classList.remove("is-loading");
  }
}

function updateKnownFolders() {
  const folders = [...new Set(state.threads.map((thread) => thread.cwd).filter(Boolean))];
  elements.knownFolders.replaceChildren(
    ...folders.slice(0, 100).map((folder) => {
      const option = document.createElement("option");
      option.value = folder;
      return option;
    }),
  );
}

function updateChatHeader() {
  const thread = activeThread();
  if (!thread) return;
  elements.chatTitle.textContent = thread.title;
  elements.chatFolder.textContent = thread.cwd;
  const working = state.sending || thread.status === "active";
  elements.chatStatus.textContent = working ? "Working" : "Idle";
  elements.chatStatus.classList.toggle("working", working);
}

async function openThread(threadId, { updateHistory = true } = {}) {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  state.activeThreadId = threadId;
  state.messages = [];
  state.loadingConversation = true;
  elements.chatLayer.classList.add("open");
  elements.chatLayer.setAttribute("aria-hidden", "false");
  updateChatHeader();
  renderMessages();
  renderRequests();
  if (updateHistory) history.pushState({ threadId }, "", `#${encodeURIComponent(threadId)}`);

  try {
    const result = await api(`/api/threads/${encodeURIComponent(threadId)}`);
    if (state.activeThreadId !== threadId) return;
    state.messages = result.messages;
  } catch (error) {
    showToast(`Could not open chat: ${error.message}`);
  } finally {
    if (state.activeThreadId === threadId) {
      state.loadingConversation = false;
      renderMessages({ forceBottom: true });
      renderRequests();
      elements.messageInput.focus();
    }
  }
}

function closeThread({ updateHistory = true } = {}) {
  state.activeThreadId = null;
  state.messages = [];
  state.sending = false;
  elements.chatLayer.classList.remove("open");
  elements.chatLayer.setAttribute("aria-hidden", "true");
  if (updateHistory) history.pushState({}, "", `${location.pathname}${location.search}`);
}

function renderMessages({ forceBottom = false } = {}) {
  const shouldStick =
    forceBottom ||
    elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight < 100;
  elements.messageList.replaceChildren();

  if (state.loadingConversation) {
    elements.messageList.append(makeElement("div", "conversation-loading", "Loading conversation…"));
  } else if (state.messages.length === 0) {
    elements.messageList.append(makeElement("div", "conversation-empty", "New chat. Send the first message below."));
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

function normalizeLiveItem(item, turnId = null) {
  if (!item) return null;
  if (item.type === "message" || item.type === "activity") return item;
  if (item.type === "agentMessage") {
    return { id: item.id, turnId, type: "message", role: "assistant", text: item.text || "" };
  }
  if (item.type === "userMessage") {
    const text = (item.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return {
      id: item.id,
      turnId,
      type: "message",
      role: "user",
      text,
      clientId: item.clientId || null,
    };
  }
  if (item.type === "commandExecution") {
    return {
      id: item.id,
      turnId,
      type: "activity",
      label: item.status === "inProgress" ? "Running command" : "Command",
      detail: item.command || "",
    };
  }
  if (item.type === "fileChange") {
    return {
      id: item.id,
      turnId,
      type: "activity",
      label: "File changes",
      detail: (item.changes || [])
        .map((change) => {
          const kind = change.kind?.type || change.kind || "change";
          return [
            `${kind}: ${change.path}`,
            change.kind?.move_path ? `Move to: ${change.kind.move_path}` : null,
            change.diff || null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n"),
    };
  }
  if (item.type === "mcpToolCall") {
    return {
      id: item.id,
      turnId,
      type: "activity",
      label: `${item.server}: ${item.tool}`,
      detail: "Tool call",
    };
  }
  if (item.type === "webSearch") {
    return { id: item.id, turnId, type: "activity", label: "Web search", detail: item.query || "" };
  }
  if (item.type === "contextCompaction") {
    return { id: item.id, turnId, type: "activity", label: "Context compacted", detail: "" };
  }
  return null;
}

function upsertLiveItem(item) {
  if (!item) return;
  let index = state.messages.findIndex((candidate) => candidate.id === item.id);
  if (index < 0 && item.clientId) {
    index = state.messages.findIndex((candidate) => candidate.clientId === item.clientId);
  }
  if (index >= 0) state.messages[index] = { ...state.messages[index], ...item, streaming: false };
  else state.messages.push(item);
  renderMessages();
}

function appendAgentDelta(params) {
  let message = state.messages.find((candidate) => candidate.id === params.itemId);
  if (!message) {
    message = {
      id: params.itemId,
      turnId: params.turnId,
      type: "message",
      role: "assistant",
      text: "",
      streaming: true,
    };
    state.messages.push(message);
  }
  message.text += params.delta || "";
  message.streaming = true;
  renderMessages();
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text || !state.activeThreadId || state.sending) return;

  const clientUserMessageId = crypto.randomUUID();
  const optimistic = {
    id: `local-${clientUserMessageId}`,
    clientId: clientUserMessageId,
    type: "message",
    role: "user",
    text,
  };
  state.messages.push(optimistic);
  elements.messageInput.value = "";
  state.sending = true;
  elements.sendButton.disabled = true;
  updateChatHeader();
  renderMessages({ forceBottom: true });

  try {
    await api(`/api/threads/${encodeURIComponent(state.activeThreadId)}/messages`, {
      method: "POST",
      body: { text, clientUserMessageId },
    });
  } catch (error) {
    state.messages = state.messages.filter((message) => message.id !== optimistic.id);
    elements.messageInput.value = text;
    state.sending = false;
    elements.sendButton.disabled = false;
    updateChatHeader();
    renderMessages();
    showToast(`Message not sent: ${error.message}`);
  }
}

function renderRequests() {
  elements.requestList.replaceChildren();
  if (!state.activeThreadId) return;
  const pending = state.requests.filter((request) => requestThreadId(request) === state.activeThreadId);
  for (const request of pending) {
    if (request.method === "item/tool/requestUserInput") {
      elements.requestList.append(createQuestionRequest(request));
    } else {
      elements.requestList.append(createApprovalRequest(request));
    }
  }
}

function createApprovalRequest(request) {
  const card = makeElement("section", "request-card");
  const labels = {
    "item/commandExecution/requestApproval": "Approve command?",
    "item/fileChange/requestApproval": "Approve file changes?",
    "item/permissions/requestApproval": "Allow extra access?",
    execCommandApproval: "Approve command?",
    applyPatchApproval: "Approve file changes?",
    "mcpServer/elicitation/request": "Tool request needs the native Codex UI",
  };
  card.append(makeElement("h3", "", labels[request.method] || "Codex needs your approval"));
  const details = Array.isArray(request.details) ? request.details : [];
  if (details.length) card.append(makeElement("div", "request-detail", details.join("\n")));

  const actions = makeElement("div", "request-actions");
  const decline = makeElement("button", "request-decline", "Decline");
  decline.type = "button";
  decline.addEventListener("click", () => answerRequest(request.requestId, { action: "decline" }));
  actions.append(decline);

  if (request.canAccept === true) {
    const accept = makeElement("button", "request-accept", "Allow once");
    accept.type = "button";
    accept.addEventListener("click", () => answerRequest(request.requestId, { action: "accept" }));
    actions.append(accept);
  } else {
    card.append(
      makeElement(
        "p",
        "",
        request.method === "mcpServer/elicitation/request"
          ? "This V0 safely declines connector forms and external URLs."
          : "Approval is disabled here. Use native Codex if more review is needed.",
      ),
    );
  }
  card.append(actions);
  return card;
}

function createQuestionRequest(request) {
  const form = makeElement("form", "request-card");
  form.append(makeElement("h3", "", "Codex needs your answer"));
  const inputs = [];
  for (const [index, question] of (request.params?.questions || []).entries()) {
    const field = makeElement("div", "question-field");
    const inputId = `question-${request.requestId}-${index}`.replace(/[^A-Za-z0-9_-]/g, "-");
    const label = makeElement("label", "", question.question);
    label.htmlFor = inputId;
    const input = document.createElement("input");
    input.id = inputId;
    input.required = true;
    input.type = question.isSecret ? "password" : "text";
    input.autocomplete = "off";
    if (question.options?.length) {
      const listId = `${inputId}-options`;
      input.setAttribute("list", listId);
      const datalist = document.createElement("datalist");
      datalist.id = listId;
      for (const optionValue of question.options) {
        const option = document.createElement("option");
        option.value = optionValue.label;
        datalist.append(option);
      }
      field.append(label, input, datalist);
    } else {
      field.append(label, input);
    }
    inputs.push({ question, input });
    form.append(field);
  }
  const actions = makeElement("div", "request-actions");
  const submit = makeElement("button", "request-accept", "Send answer");
  submit.type = "submit";
  actions.append(submit);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answers = Object.fromEntries(
      inputs.map(({ question, input }) => [question.id, { answers: [input.value] }]),
    );
    answerRequest(request.requestId, { answers });
  });
  return form;
}

async function answerRequest(requestId, body) {
  try {
    await api(`/api/requests/${encodeURIComponent(requestId)}/respond`, { method: "POST", body });
    state.requests = state.requests.filter((request) => request.requestId !== requestId);
    renderRequests();
    renderBoard();
  } catch (error) {
    showToast(`Could not answer Codex: ${error.message}`);
  }
}

async function loadRequests() {
  try {
    const result = await api("/api/requests");
    state.requests = result.requests;
    renderRequests();
    renderBoard();
  } catch (error) {
    showToast(error.message);
  }
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.onopen = () => setConnection("Connected", "ready");
  events.onerror = () => setConnection("Reconnecting", "loading");
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "connected") return;
    if (payload.type === "fatal") {
      setConnection("Codex stopped", "error");
      showToast(payload.message);
      return;
    }
    if (payload.type === "refresh") {
      loadThreads({ silent: true });
      loadRequests();
      if (state.activeThreadId) loadConversationAfterTurn(state.activeThreadId);
      return;
    }
    if (payload.type === "serverRequest") {
      state.requests = state.requests.filter(
        (request) => request.requestId !== payload.request.requestId,
      );
      state.requests.push(payload.request);
      renderRequests();
      renderBoard();
      return;
    }
    if (payload.type === "serverRequestResolved") {
      state.requests = state.requests.filter(
        (request) => request.requestId !== payload.requestId,
      );
      renderRequests();
      renderBoard();
      return;
    }
    if (payload.type !== "codex") return;
    handleCodexEvent(payload.message);
  };
}

function handleCodexEvent(message) {
  const params = message.params || {};
  const isActive = params.threadId === state.activeThreadId;

  if (message.method === "item/agentMessage/delta" && isActive) {
    appendAgentDelta(params);
    return;
  }
  if ((message.method === "item/started" || message.method === "item/completed") && isActive) {
    upsertLiveItem(normalizeLiveItem(params.item, params.turnId));
    return;
  }
  if (message.method === "turn/started") {
    const thread = state.threads.find((candidate) => candidate.id === params.threadId);
    if (thread) thread.status = "active";
    if (isActive) {
      state.sending = true;
      elements.sendButton.disabled = true;
      updateChatHeader();
    }
    renderBoard();
    return;
  }
  if (message.method === "turn/completed") {
    const thread = state.threads.find((candidate) => candidate.id === params.threadId);
    if (thread) thread.status = "idle";
    if (isActive) {
      state.sending = false;
      elements.sendButton.disabled = false;
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
    if (isActive) {
      state.sending = false;
      elements.sendButton.disabled = false;
      updateChatHeader();
    }
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

function openNewChatDialog() {
  elements.newChatError.textContent = "";
  elements.cwdInput.value = activeThread()?.cwd || state.threads[0]?.cwd || state.defaultCwd;
  elements.newChatDialog.showModal();
  elements.cwdInput.select();
}

async function createNewChat(event) {
  event.preventDefault();
  const cwd = elements.cwdInput.value.trim();
  if (!cwd) return;
  elements.createChatButton.disabled = true;
  elements.newChatError.textContent = "";
  try {
    const result = await api("/api/threads", { method: "POST", body: { cwd } });
    elements.newChatDialog.close();
    await loadThreads({ silent: true });
    const exists = state.threads.some((thread) => thread.id === result.thread.id);
    if (!exists) state.threads.unshift(result.thread);
    renderBoard();
    openThread(result.thread.id);
  } catch (error) {
    elements.newChatError.textContent = error.message;
  } finally {
    elements.createChatButton.disabled = false;
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
elements.newChatButton.addEventListener("click", openNewChatDialog);
elements.closeChatButton.addEventListener("click", () => closeThread());
elements.chatBackdrop.addEventListener("click", () => closeThread());
elements.composerForm.addEventListener("submit", sendMessage);
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composerForm.requestSubmit();
  }
});
elements.closeDialogButton.addEventListener("click", () => elements.newChatDialog.close());
elements.cancelNewChatButton.addEventListener("click", () => elements.newChatDialog.close());
elements.newChatForm.addEventListener("submit", createNewChat);

window.addEventListener("popstate", () => {
  const threadId = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (threadId) openThread(threadId, { updateHistory: false });
  else closeThread({ updateHistory: false });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || elements.newChatDialog.open) return;
  if (state.activeThreadId) closeThread();
});

async function initialize() {
  try {
    const health = await api("/api/health");
    state.defaultCwd = health.defaultCwd || "";
    setConnection(health.ok ? "Connected" : "Starting", health.ok ? "ready" : "loading");
  } catch {
    setConnection("Disconnected", "error");
  }
  connectEvents();
  await Promise.all([loadThreads(), loadRequests()]);
  const initialThreadId = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (initialThreadId && state.threads.some((thread) => thread.id === initialThreadId)) {
    openThread(initialThreadId, { updateHistory: false });
  }
}

initialize();
