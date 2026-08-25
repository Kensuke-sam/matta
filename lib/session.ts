import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "matta_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_PIN_LENGTH = 8;

function configuredPin(): string {
  return process.env.MATTA_DEMO_PIN?.trim() ?? "";
}

export function pinConfigured(): boolean {
  return configuredPin().length >= MIN_PIN_LENGTH;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyPin(pin: string): boolean {
  if (!pinConfigured()) return false;
  return timingSafeEqual(sha256(pin), sha256(configuredPin()));
}

// PINから導出した鍵でトークンを署名する。PINを変えると既存セッションは無効になる
function signingKey(): Buffer {
  return sha256(`matta-session-key:v1:${configuredPin()}`);
}

function mac(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload, "utf8").digest("hex");
}

export function createSessionToken(now: number = Date.now()): string {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${mac(String(exp))}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token || !pinConfigured()) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expRaw = token.slice(0, dot);
  const macHex = token.slice(dot + 1);
  if (!/^\d{1,16}$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(macHex)) return false;
  const expected = mac(expRaw);
  if (!timingSafeEqual(Buffer.from(macHex, "hex"), Buffer.from(expected, "hex"))) {
    return false;
  }
  return Number(expRaw) > now;
}

function secureAttribute(): string {
  // Vercel上は常にHTTPSなのでSecureを付ける。ローカルは付けない
  return process.env.VERCEL === "1" ? "; Secure" : "";
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_TTL_MS / 1000
  }${secureAttribute()}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute()}`;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function isAuthenticated(req: Request): boolean {
  return verifySessionToken(readSessionToken(req));
}
