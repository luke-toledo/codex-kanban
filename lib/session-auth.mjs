import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "codex_kanban_session";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function safelyEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidBootstrapToken(candidate, sessionToken) {
  return safelyEqual(candidate, sessionToken);
}

export function hasValidSession(cookieHeader, sessionToken) {
  if (typeof cookieHeader !== "string") return false;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === COOKIE_NAME) return safelyEqual(value, sessionToken);
  }
  return false;
}

export function createSessionCookie(sessionToken) {
  return `${COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
}
