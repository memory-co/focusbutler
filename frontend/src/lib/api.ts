export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  keepalive?: boolean;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let url = `/api${path}`;
  if (options.query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) if (v !== undefined) q.set(k, String(v));
    if (q.size) url += `?${q}`;
  }
  let response: Response;
  try {
    response = await fetch(url, { method: options.method || "GET", headers, body, signal: options.signal, keepalive: options.keepalive });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError("无法连接服务器", 0);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    const detail = Array.isArray(result?.detail)
      ? result.detail.map((d: { msg: string }) => d.msg).join("；")
      : result?.detail;
    throw new ApiError(detail || `请求失败 (${response.status})`, response.status);
  }
  return result as T;
}

/** 本地时区相对 UTC 的分钟数，东八区 = 480。统计接口用它按本地日期分组。 */
export const tzOffset = () => -new Date().getTimezoneOffset();
