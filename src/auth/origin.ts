import type { Request } from "express";

export function publicOrigin(req: Request, publicUrl: string | undefined): string {
  if (publicUrl !== undefined && publicUrl.length > 0) {
    try {
      return new URL(publicUrl).origin;
    } catch {
      return publicUrl.replace(/\/+$/, "");
    }
  }
  const proto = req.secure ? "https" : "http";
  const host = headerFirst(req.headers.host) ?? "127.0.0.1";
  return `${proto}://${host}`;
}

function headerFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
