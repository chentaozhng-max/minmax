import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiBody<T> = { code: number; message: string; data: T | null };

export function ok<T>(data: T, message = "ok") {
  return NextResponse.json<ApiBody<T>>({ code: 0, message, data });
}

export function fail(status: number, message: string, code = status) {
  return NextResponse.json<ApiBody<null>>({ code, message, data: null }, { status });
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message);
}

/** 统一的 Route Handler 包装：把 ApiError / ZodError 转成约定的响应体 */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message);
      if (error instanceof ZodError) {
        return fail(400, error.issues[0]?.message ?? "参数不合法");
      }
      console.error("[api] unhandled", error);
      const message = error instanceof Error ? error.message : "服务器开小差了";
      return fail(500, message);
    }
  };
}
