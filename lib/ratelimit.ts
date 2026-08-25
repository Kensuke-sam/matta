/**
 * インスタンス内メモリの簡易レートリミッタ（固定ウィンドウ）。
 * サーバーレスではインスタンスごとに独立するベストエフォートの保護で、
 * PIN総当たりとAPIコストの抑制が目的。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Mapの単調増加を防ぐ。この件数を超えたら期限切れエントリを掃除する
const SWEEP_THRESHOLD = 5000;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  if (buckets.size > SWEEP_THRESHOLD) sweepExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function _resetRateLimit(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

// 上限はテスト環境（E2E）だけ環境変数で緩められる。起動時に固定される
function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

export const SESSION_RATE = {
  limit: envLimit("MATTA_SESSION_RATE_LIMIT", 10),
  windowMs: 15 * 60 * 1000,
};
export const ANALYZE_RATE = {
  limit: envLimit("MATTA_ANALYZE_RATE_LIMIT", 30),
  windowMs: 60 * 60 * 1000,
};
