"use client";

import type { ApiErrorBody, ApiErrorCode } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | "network",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network", "通信に失敗しました。接続を確認してください。", 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 空ボディや非JSONは下の分岐で処理する
  }
  if (!res.ok) {
    const errorBody = body as ApiErrorBody | null;
    const code = errorBody?.error?.code ?? "internal_error";
    const message = errorBody?.error?.message ?? "エラーが発生しました。";
    throw new ApiError(code, message, res.status);
  }
  return body as T;
}
