import { runAnalyze } from "@/lib/analyze";
import { errorResponse, jsonResponse } from "@/lib/http";
import { openaiConfigured, UpstreamError } from "@/lib/openai";
import { ANALYZE_RATE, clientIp, rateLimit } from "@/lib/ratelimit";
import { isAuthenticated } from "@/lib/session";
import { validateAnalyzeInput } from "@/lib/validate";

// LLM呼び出しが複数回連なるため、Vercel Function側の上限を明示する
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!isAuthenticated(request)) {
    return errorResponse("unauthorized", "PINでログインしてください。", 401);
  }
  if (!rateLimit(`analyze:${clientIp(request)}`, ANALYZE_RATE.limit, ANALYZE_RATE.windowMs)) {
    return errorResponse(
      "rate_limited",
      "利用回数の上限に達しました。しばらく待ってからやり直してください。",
      429,
    );
  }
  if (!openaiConfigured()) {
    return errorResponse(
      "openai_not_configured",
      "AI機能が未設定です。管理者は環境変数 OPENAI_API_KEY を設定してください。",
      503,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_input", "リクエスト形式が正しくありません。", 400);
  }
  const validated = validateAnalyzeInput(body);
  if (!validated.ok) {
    return errorResponse("invalid_input", validated.message, 400);
  }
  try {
    const result = await runAnalyze(validated.value);
    return jsonResponse(result);
  } catch (err) {
    // 相談内容を含み得るため、エラーコード以外はログへ出さない
    if (err instanceof UpstreamError) {
      console.error(`[matta] analyze failed: ${err.code}`);
      switch (err.code) {
        case "openai_not_configured":
          return errorResponse(
            "openai_not_configured",
            "AI機能が未設定です。管理者は環境変数 OPENAI_API_KEY を設定してください。",
            503,
          );
        case "upstream_timeout":
          return errorResponse(
            "upstream_timeout",
            "AIの応答が時間内に返りませんでした。もう一度お試しください。",
            504,
          );
        case "invalid_output":
          return errorResponse(
            "invalid_output",
            "AIの応答を解釈できませんでした。もう一度お試しください。",
            502,
          );
        default:
          return errorResponse(
            "upstream_error",
            "AIとの通信に失敗しました。もう一度お試しください。",
            502,
          );
      }
    }
    console.error("[matta] analyze failed: internal_error");
    return errorResponse("internal_error", "処理中にエラーが発生しました。", 500);
  }
}
