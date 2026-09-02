const MAX_APPROVAL_DETAIL_LENGTH = 64 * 1024;
const UNSAFE_DISPLAY_CHARACTERS =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;

function visibleText(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.replace(UNSAFE_DISPLAY_CHARACTERS, (character) => {
    const code = character.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function visibleJson(value) {
  try {
    return visibleText(JSON.stringify(value, null, 2));
  } catch {
    return null;
  }
}

function commandDetail(command) {
  if (typeof command === "string") {
    const visible = visibleText(command);
    return visible ? `Command:\n${visible}` : null;
  }
  if (!Array.isArray(command) || command.length === 0) return null;
  const argumentsList = command.map((argument, index) => {
    const visible = visibleText(argument);
    return visible ? `[${index}] ${JSON.stringify(visible)}` : null;
  });
  return argumentsList.every(Boolean) ? `Command arguments:\n${argumentsList.join("\n")}` : null;
}

function networkDetail(context) {
  if (context == null) return { detail: null, valid: true };
  const host = visibleText(context.host);
  const protocol = visibleText(context.protocol);
  if (!host || !protocol) return { detail: null, valid: false };
  return { detail: `Network:\n${protocol}://${host}`, valid: true };
}

function fileChangeDetail(change) {
  const filePath = visibleText(change?.path);
  const kind = visibleText(change?.kind?.type);
  const diff = visibleText(change?.diff);
  if (!filePath || !kind || !diff || !["add", "delete", "update"].includes(kind)) return null;
  const movePath = visibleText(change.kind.move_path);
  if (change.kind.move_path != null && !movePath) return null;
  return [
    `File: ${filePath}`,
    `Action: ${kind}`,
    movePath ? `Move to: ${movePath}` : null,
    diff,
  ]
    .filter(Boolean)
    .join("\n");
}

function legacyFileChangesDetail(fileChanges) {
  if (!fileChanges || typeof fileChanges !== "object" || Array.isArray(fileChanges)) return null;
  const entries = Object.entries(fileChanges);
  if (entries.length === 0) return null;

  const details = entries.map(([rawPath, change]) => {
    const filePath = visibleText(rawPath);
    const kind = visibleText(change?.type);
    if (!filePath || !["add", "delete", "update"].includes(kind)) return null;
    const content = kind === "update" ? visibleText(change.unified_diff) : visibleText(change.content);
    if (!content) return null;
    const movePath = visibleText(change.move_path);
    if (change.move_path != null && !movePath) return null;
    return [
      `File: ${filePath}`,
      `Action: ${kind}`,
      movePath ? `Move to: ${movePath}` : null,
      content,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return details.every(Boolean) ? details.join("\n\n") : null;
}

function safeOpaqueId(value) {
  return typeof value === "string" && value.length <= 256 ? value : null;
}

function publicQuestion(question) {
  const id = safeOpaqueId(question?.id);
  const prompt = visibleText(question?.question);
  if (!id || !prompt) return null;
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => {
          const label = visibleText(option?.label);
          return label ? { label } : null;
        })
        .filter(Boolean)
    : [];
  return { id, question: prompt, isSecret: Boolean(question.isSecret), options };
}

function finalizeReview(request, details, canAccept, params = {}) {
  const safeDetails = details.filter(Boolean);
  const oversized = safeDetails.join("\n\n").length > MAX_APPROVAL_DETAIL_LENGTH;
  return {
    requestId: String(request.id),
    method: request.method,
    params: {
      threadId: safeOpaqueId(request.params?.threadId),
      conversationId: safeOpaqueId(request.params?.conversationId),
      ...params,
    },
    details: oversized
      ? ["Details are too large to review safely here. Use the native Codex UI."]
      : safeDetails,
    canAccept: Boolean(canAccept && !oversized),
  };
}

export function reviewServerRequest(request, item = null) {
  const params = request.params || {};
  const reason = visibleText(params.reason);
  const details = reason ? [`Reason:\n${reason}`] : [];

  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval": { 
      const command = commandDetail(params.command);
      const cwd = visibleText(params.cwd);
      const network = networkDetail(params.networkApprovalContext);
      if (command) details.push(command);
      if (cwd) details.push(`Folder:\n${cwd}`);
      if (network.detail) details.push(network.detail);
      const permissions = params.additionalPermissions
        ? visibleJson(params.additionalPermissions)
        : null;
      if (permissions) details.push(`Additional permissions:\n${permissions}`);
      if (params.grantRoot) details.push(`Session write access requested:\n${visibleText(params.grantRoot) || "Unknown"}`);
      const available = params.availableDecisions;
      const allowsOnce = !Array.isArray(available) || available.includes("accept");
      const supportedKind = request.method === "execCommandApproval" || (params.kind || "command") === "command";
      return finalizeReview(
        request,
        details,
        command && cwd && network.valid && supportedKind && allowsOnce && !params.grantRoot,
      );
    }
    case "item/fileChange/requestApproval": { 
      if (params.grantRoot) {
        details.push(`Session write access requested:\n${visibleText(params.grantRoot) || "Unknown"}`);
      }
      const changes = item?.type === "fileChange" ? item.changes : null;
      const changeDetails = Array.isArray(changes) ? changes.map(fileChangeDetail) : [];
      if (changeDetails.length > 0 && changeDetails.every(Boolean)) details.push(changeDetails.join("\n\n"));
      return finalizeReview(
        request,
        details,
        !params.grantRoot && changeDetails.length > 0 && changeDetails.every(Boolean),
      );
    }
    case "applyPatchApproval": { 
      if (params.grantRoot) {
        details.push(`Session write access requested:\n${visibleText(params.grantRoot) || "Unknown"}`);
      }
      const changes = legacyFileChangesDetail(params.fileChanges);
      if (changes) details.push(changes);
      return finalizeReview(request, details, changes && !params.grantRoot);
    }
    case "item/permissions/requestApproval": { 
      const permissions = visibleJson(params.permissions);
      if (permissions) details.push(`Requested permissions for this turn:\n${permissions}`);
      return finalizeReview(request, details, Boolean(permissions));
    }
    case "item/tool/requestUserInput": {
      const questions = Array.isArray(params.questions)
        ? params.questions.map(publicQuestion).filter(Boolean)
        : [];
      return finalizeReview(request, [], false, { questions });
    }
    case "mcpServer/elicitation/request": {
      const serverName = visibleText(params.serverName);
      const message = visibleText(params.message);
      const url = visibleText(params.url);
      if (serverName) details.push(`Connector:\n${serverName}`);
      if (message) details.push(`Request:\n${message}`);
      if (url) details.push(`External URL:\n${url}`);
      return finalizeReview(request, details, false);
    }
    default:
      return finalizeReview(request, ["Unsupported request. Use the native Codex UI."], false);
  }
}
