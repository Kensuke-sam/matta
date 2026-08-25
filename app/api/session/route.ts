import { errorResponse, jsonResponse } from "@/lib/http";
import { clientIp, rateLimit, SESSION_RATE } from "@/lib/ratelimit";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  isAuthenticated,
  pinConfigured,
  verifyPin,
} from "@/lib/session";
import { validatePinInput } from "@/lib/validate";
import type { SessionStateResponse } from "@/lib/types";

export async function POST(request: Request): Promise<Response> {
  if (!rateLimit(`session:${clientIp(request)}`, SESSION_RATE.limit, SESSION_RATE.windowMs)) {
    return errorResponse(
      "rate_limited",
      "試行回数が多すぎます。しばらく待ってからやり直してください。",
      429,
    );
  }
  if (!pinConfigured()) {
    return errorResponse(
      "pin_not_configured",
      "デモ用PINが未設定です。管理者は環境変数 MATTA_DEMO_PIN（8文字以上）を設定してください。",
      503,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_input", "リクエスト形式が正しくありません。", 400);
  }
  const validated = validatePinInput(body);
  if (!validated.ok) {
    return errorResponse("invalid_input", validated.message, 400);
  }
  if (!verifyPin(validated.pin)) {
    return errorResponse("invalid_pin", "PINが一致しません。", 401);
  }
  return jsonResponse({ ok: true }, 200, {
    "set-cookie": buildSessionCookie(createSessionToken()),
  });
}

export async function GET(request: Request): Promise<Response> {
  const body: SessionStateResponse = { authenticated: isAuthenticated(request) };
  return jsonResponse(body);
}

export async function DELETE(): Promise<Response> {
  return jsonResponse({ ok: true }, 200, { "set-cookie": buildClearSessionCookie() });
}
