export type ApiEnvelope<T> = { code: number; message: string; data: T | null };

export class ApiClientError extends Error {
  status: number;
  /** true = 一个字节都没收到（断网 / 服务重启中 / 被拦截），false = 服务器回了话但业务失败 */
  network: boolean;
  constructor(message: string, status: number, network = false) {
    super(message);
    this.status = status;
    this.network = network;
  }
}

/** 额外的客户端参数，不会透传给 fetch */
export type ApiOptions = RequestInit & {
  /** 网络层失败时再试几次（默认 0）。只给幂等请求开，避免重复报名 / 重复发布 */
  retryNetworkError?: number;
};

const NETWORK_ERROR_HINT = "网络没连上，请检查网络后重试";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 统一的客户端请求封装：解包 { code, message, data }，失败直接抛 message */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { retryNetworkError = 0, ...init } = options;
  const attempts = Math.max(0, retryNetworkError) + 1;

  let lastError: ApiClientError | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(400 * i); // 400ms、800ms 递增，给刚重启的服务一点时间
    try {
      return await once<T>(path, init);
    } catch (error) {
      if (error instanceof ApiClientError && error.network) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new ApiClientError(NETWORK_ERROR_HINT, 0, true);
}

async function once<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      credentials: "same-origin",
    });
  } catch {
    // fetch 只在"一个字节都没收到"时抛 TypeError: Failed to fetch。
    // 直接透给用户就是一句英文，这里统一翻译成人话。
    throw new ApiClientError(NETWORK_ERROR_HINT, 0, true);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // 走到了这里说明是网关/平台自己的 HTML 错误页，不是我们的接口：
    // 最常见的是分享链接缺了 sharecode，其次是服务正在重启。
    if (res.status === 403) throw new ApiClientError("分享链接已失效，请重新打开链接", 403);
    throw new ApiClientError("服务器暂时没响应，请稍后重试", res.status);
  }

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

export function postJson<T>(path: string, body?: unknown, options: ApiOptions = {}) {
  return api<T>(path, {
    ...options,
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
