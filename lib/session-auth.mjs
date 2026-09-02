import { randomBytes, timingSafeEqual } from "node:crypto";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function safelyEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidSessionToken(candidate, sessionToken) {
  return safelyEqual(candidate, sessionToken);
}
