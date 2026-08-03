import type { IncomingMessage } from "node:http";

export function prefersHtml(req: IncomingMessage): boolean {
  return req.headers.accept?.includes("text/html") ?? false;
}

export function prefersJson(req: IncomingMessage): boolean {
  return req.headers.accept?.includes("application/json") ?? false;
}

export function isTrustedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!host) return false;
  if (!origin) return true;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
