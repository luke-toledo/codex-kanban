const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseLocalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
    return url;
  } catch {
    return null;
  }
}

export function isAllowedHost(hostHeader, port) {
  if (typeof hostHeader !== "string" || !hostHeader) return false;
  const url = parseLocalUrl(`http://${hostHeader}`);
  return Boolean(url && url.port === String(port) && url.host.toLowerCase() === hostHeader.toLowerCase());
}

export function isAllowedOrigin(origin, hostHeader, port) {
  const expectedHost = `127.0.0.1:${port}`;
  return (
    origin === `http://${expectedHost}` &&
    String(hostHeader).toLowerCase() === expectedHost
  );
}

export function assertLocalRequest(request, port) {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress)) {
    throw new HttpError(403, "Only local connections are allowed");
  }
  if (!isAllowedHost(request.headers.host, port)) {
    throw new HttpError(403, "Untrusted Host header");
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "Cross-site request blocked");
  }
}

export function assertLocalMutation(request, port) {
  assertLocalRequest(request, port);
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  if (!isAllowedOrigin(request.headers.origin, request.headers.host, port)) {
    throw new HttpError(403, "Cross-origin mutation blocked");
  }
}
