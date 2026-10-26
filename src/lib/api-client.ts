export type ApiEnvelope<T> = { code: number; message: string; data: T | null };

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** 统一的客户端请求封装：解包 { code, message, data }，失败直接抛 message */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError("服务器返回了无法解析的内容", res.status);
  }

  if (!res.ok || payload.code !== 0) {
    throw new ApiClientError(payload?.message || "请求失败", res.status);
  }
  return payload.data as T;
}

export function postJson<T>(path: string, body?: unknown) {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
