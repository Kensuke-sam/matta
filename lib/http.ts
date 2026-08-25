import type { ApiErrorBody, ApiErrorCode } from "./types";

export function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(code: ApiErrorCode, message: string, status: number): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return jsonResponse(body, status);
}
