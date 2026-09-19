import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const HKDF_SALT = "mcp-oauth";

export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function hmacKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, "hmac", 32));
}

function encKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, "enc", 32));
}

function csrfKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, "csrf", 32));
}

export function sign(secret: string, payload: string): string {
  return createHmac("sha256", hmacKey(secret)).update(payload).digest("base64url");
}

export function verifyHmac(secret: string, payload: string, mac: string): boolean {
  return verifyMac(sign(secret, payload), mac);
}

export function signCsrf(secret: string, payload: string): string {
  return createHmac("sha256", csrfKey(secret)).update(payload).digest("base64url");
}

export function verifyCsrfMac(secret: string, payload: string, mac: string): boolean {
  return verifyMac(signCsrf(secret, payload), mac);
}

function verifyMac(expectedMac: string, mac: string): boolean {
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(expectedMac, "base64url");
    actual = Buffer.from(mac, "base64url");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function encryptString(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptString(secret: string, blob: string): string {
  const buf = Buffer.from(blob, "base64url");
  if (buf.length < 28) throw new Error("invalid ciphertext");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function safeEqualText(secret: string, left: string, right: string): boolean {
  const a = createHmac("sha256", hmacKey(secret)).update(left).digest();
  const b = createHmac("sha256", hmacKey(secret)).update(right).digest();
  return timingSafeEqual(a, b);
}
