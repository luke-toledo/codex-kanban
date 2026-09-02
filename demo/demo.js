const COLUMNS = ["backlog", "todo", "in-progress", "review", "done"];

const EXAMPLE_MESSAGES = [
  { role: "user", text: "Can you handle this without expanding the scope? Give me the smallest useful result." },
  { role: "assistant", text: "Yes. I’ll inspect the current state, make the narrow change, verify the affected surface, and bring back the result." },
  { role: "activity", text: "Checked the relevant files", detail: "demo-product/app\ndemo-product/tests" },
  { role: "assistant", text: "Done. The focused change works, the relevant checks pass, and no unrelated behavior changed." },
];

const INITIAL_TASKS = [
  ["demo-01", "Map the first-run experience", "demo-product", "backlog", 0, "3h ago", "unknown", false],
  ["demo-02", "Collect onboarding friction notes", "demo-research", "backlog", 1, "yesterday", "unknown", false],
  ["demo-03", "Archive old experiment threads", "demo-product", "backlog", 2, "2d ago", "unknown", true],
  ["demo-04", "Draft empty-state copy", "demo-product", "todo", 0, "1h ago", "unknown", false],
  ["demo-05", "Turn feedback into three testable bets", "demo-research", "todo", 1, "4h ago", "unknown", false],
  ["demo-06", "Prepare customer interview prompts", "demo-growth", "todo", 2, "yesterday", "unknown", false],
  ["demo-07", "Build keyboard-friendly card movement", "codex-kanban-demo", "in-progress", 0, "now", "active", false],
  ["demo-08", "Prototype the task preview panel", "codex-kanban-demo", "in-progress", 1, "now", "active", false],
  ["demo-09", "Verify private-session recovery", "codex-kanban-demo", "review", 0, "26m ago", "unknown", false],
  ["demo-10", "Review organization-focused README", "codex-kanban-demo", "review", 1, "1h ago", "unknown", false],
  ["demo-11", "Add Codex deep links", "codex-kanban-demo", "done", 0, "today", "idle", false],
  ["demo-12", "Document local-only storage", "codex-kanban-demo", "done", 1, "yesterday", "idle", false],
];

const freshTasks = () => INITIAL_TASKS.map(([id, title, folder, column, order, updated, status, hidden]) => ({
  id, title, folder, column, order, updated, status, hidden,
}));

const state = {
  tasks: freshTasks(),
  showHidden: false,
  activeTaskId: null,
  draggedId: null,
  suppressCardClick: false,
  returnFocusElement: null,
};

const elements = {
  appShell: document.querySelector("#appShell"),
  boardSummary: document.querySelector("#boardSummary"),
  hiddenToggleButton: document.querySelector("#hiddenToggleButton"),
  hiddenToggleLabel: document.querySelector("#hiddenToggleLabel"),
  hiddenCount: document.querySelector("#hiddenCount"),
  resetButton: document.querySelector("#resetButton"),
  chatLayer: document.querySelector("#chatLayer"),
  chatBackdrop: document.querySelector("#chatBackdrop"),
  closeChatButton: document.querySelector("#closeChatButton"),
  chatTitle: document.querySelector("#chatTitle"),
  chatFolder: document.querySelector("#chatFolder"),
  chatStatus: document.querySelector("#chatStatus"),
  messageList: document.querySelector("#messageList"),
  demoCodexButton: document.querySelector("#demoCodexButton"),
  toast: document.querySelector("#toast"),
};

const columnLists = new Map(COLUMNS.map((column) => [column, document.querySelector(`[data-list="${column}"]`)]));
let toastTimer = null;

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
  const paths = {
    external: ["path", { d: "M8 16 16 8M9 8h7v7" }],
    hide: ["path", { d: "M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Zm1.5-8 16 16" }],
    show: ["path", { d: "M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" }],
  };
  const [tag, attributes] = paths[name];
  const shape = document.createElementNS(namespace, tag);
  for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
  shape.setAttribute("fill", "none");
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.8");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  svg.append(shape);
  return svg;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function renderBoard() {
  const hiddenTotal = state.tasks.filter((task) => task.hidden).length;
  if (hiddenTotal === 0) state.showHidden = false;
  elements.hiddenToggleButton.disabled = hiddenTotal === 0;
  elements.hiddenToggleButton.setAttribute("aria-pressed", String(state.showHidden));
  elements.hiddenToggleButton.setAttribute("aria-label", state.showHidden ? "Hide hidden tasks" : `Show ${hiddenTotal} hidden tasks`);
  elements.hiddenToggleLabel.textContent = state.showHidden ? "Hide hidden" : "Show hidden";
  elements.hiddenCount.textContent = String(hiddenTotal);
  elements.hiddenCount.hidden = hiddenTotal === 0;

  for (const column of COLUMNS) {
    const list = columnLists.get(column);
    const columnTasks = state.tasks.filter((task) => task.column === column).sort((left, right) => left.order - right.order);
    const visibleTasks = columnTasks.filter((task) => !task.hidden || state.showHidden);
    list.replaceChildren(...visibleTasks.map(createTaskCard));
    document.querySelector(`[data-count="${column}"]`).textContent = String(visibleTasks.length);
    if (visibleTasks.length === 0) list.append(makeElement("div", "empty-column", columnTasks.length ? "No visible chats" : "Drop chats here"));
  }

  elements.boardSummary.textContent = hiddenTotal
    ? state.showHidden
      ? `${state.tasks.length} fake tasks · ${hiddenTotal} hidden shown`
      : `${state.tasks.length - hiddenTotal} visible · ${hiddenTotal} hidden`
    : `${state.tasks.length} fake tasks · drag to organize`;
}

function createTaskCard(task) {
  const card = makeElement("article", "task-card");
  card.classList.toggle("is-hidden", task.hidden);
  card.dataset.threadId = task.id;
  card.draggable = true;

  const heading = makeElement("div", "card-heading");
  const previewButton = makeElement("button", "card-preview-button");
  previewButton.type = "button";
  previewButton.dataset.cardAction = "true";
  previewButton.setAttribute("aria-label", `Preview ${task.title}`);
  previewButton.append(makeElement("span", "card-title", task.title));
  previewButton.addEventListener("click", () => openTask(task.id));
  heading.append(previewButton);

  const actions = makeElement("div", "card-actions");
  const hideButton = makeElement("button", "card-action card-hide-button");
  hideButton.type = "button";
  hideButton.dataset.cardAction = "true";
  hideButton.title = task.hidden ? "Show task" : "Hide task";
  hideButton.setAttribute("aria-label", `${task.hidden ? "Show" : "Hide"} ${task.title}`);
  hideButton.append(makeIcon(task.hidden ? "show" : "hide"));
  hideButton.addEventListener("click", () => setTaskHidden(task.id, !task.hidden));

  const codexButton = makeElement("button", "card-action card-codex-link");
  codexButton.type = "button";
  codexButton.dataset.cardAction = "true";
  codexButton.title = "Open in Codex";
  codexButton.setAttribute("aria-label", `Open ${task.title} in Codex`);
  codexButton.append(makeIcon("external"));
  codexButton.addEventListener("click", () => showToast("The real app opens this exact task in Codex"));
  actions.append(hideButton, codexButton);
  heading.append(actions);

  const meta = makeElement("div", "card-meta");
  meta.append(makeElement("span", "card-folder", task.folder));
  if (task.hidden) meta.append(makeElement("span", "card-hidden-label", "Hidden"));
  else if (task.status === "active") meta.append(makeElement("span", "card-state", "Working"));
  else meta.append(makeElement("time", "", task.updated));
  card.append(heading, meta);

  card.addEventListener("click", (event) => {
    if (event.target.closest("[data-card-action]")) return;
    if (!state.suppressCardClick) openTask(task.id);
  });
  card.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest(".card-actions")) {
      event.preventDefault();
      return;
    }
    state.draggedId = task.id;
    state.suppressCardClick = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => {
    state.draggedId = null;
    card.classList.remove("dragging");
    for (const list of columnLists.values()) list.classList.remove("drag-over");
    setTimeout(() => { state.suppressCardClick = false; }, 0);
  });
  return card;
}

function setTaskHidden(taskId, hidden) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return;
  task.hidden = hidden;
  renderBoard();
  elements.hiddenToggleButton.focus();
  showToast(hidden ? "Task hidden" : "Task shown");
}

function moveTask(taskId, column, beforeTaskId = null) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || !COLUMNS.includes(column)) return;
  const buckets = Object.fromEntries(COLUMNS.map((key) => [key, []]));
  for (const candidate of [...state.tasks].sort((left, right) => left.order - right.order)) {
    if (candidate.id !== taskId) buckets[candidate.column].push(candidate);
  }
  const destination = buckets[column];
  const targetIndex = beforeTaskId ? destination.findIndex((candidate) => candidate.id === beforeTaskId) : -1;
  destination.splice(targetIndex >= 0 ? targetIndex : destination.length, 0, task);
  for (const key of COLUMNS) buckets[key].forEach((candidate, order) => Object.assign(candidate, { column: key, order }));
  renderBoard();
}

function openTask(taskId) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return;
  state.returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.activeTaskId = taskId;
  elements.chatTitle.textContent = task.title;
  elements.chatFolder.textContent = task.folder;
  const working = task.status === "active";
  elements.chatStatus.textContent = working ? "Working" : task.status === "idle" ? "Idle" : "Unknown";
  elements.chatStatus.className = `chat-status ${working ? "working" : task.status === "idle" ? "idle" : "unknown"}`;
  elements.messageList.replaceChildren();
  for (const message of EXAMPLE_MESSAGES) {
    if (message.role === "activity") {
      const row = makeElement("div", "activity-row");
      const details = document.createElement("details");
      details.append(makeElement("summary", "", message.text), makeElement("pre", "", message.detail));
      row.append(details);
      elements.messageList.append(row);
      continue;
    }
    const row = makeElement("div", `message-row ${message.role}`);
    row.append(makeElement("div", "message-bubble", message.text));
    elements.messageList.append(row);
  }
  elements.chatLayer.classList.add("open");
  elements.chatLayer.setAttribute("aria-hidden", "false");
  elements.appShell.inert = true;
  elements.closeChatButton.focus();
}

function closeTask() {
  state.activeTaskId = null;
  elements.chatLayer.classList.remove("open");
  elements.chatLayer.setAttribute("aria-hidden", "true");
  elements.appShell.inert = false;
  if (state.returnFocusElement?.isConnected) state.returnFocusElement.focus();
  state.returnFocusElement = null;
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
    if (target && event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2) beforeId = target.nextElementSibling?.dataset?.threadId || null;
    if (beforeId !== draggedId) moveTask(draggedId, column, beforeId);
  });
}

elements.hiddenToggleButton.addEventListener("click", () => {
  state.showHidden = !state.showHidden;
  renderBoard();
});
elements.resetButton.addEventListener("click", () => {
  state.tasks = freshTasks();
  state.showHidden = false;
  renderBoard();
  showToast("Demo reset");
});
elements.closeChatButton.addEventListener("click", closeTask);
elements.chatBackdrop.addEventListener("click", closeTask);
elements.demoCodexButton.addEventListener("click", () => showToast("The installed app opens this exact task in Codex"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.activeTaskId) closeTask();
});

renderBoard();
