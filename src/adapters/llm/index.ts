/**
 * LLM 适配器工厂 —— 唯一一处「根据环境变量决定用哪个实现」的地方。
 *
 * 上层（application / server）只调 getLlm()，永远不知道背后是真实模型还是脚本假模型。
 * 换 provider、加新 provider，都只改这个文件。
 */
import type { LlmPort, LlmReply, LlmToolSpec, LlmMessage } from "@/domain/ports/llm";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import { MockLlm } from "./mock";

export type LlmProvider = "openai-compatible" | "mock";

/**
 * 环境变量的最小形状。
 * 不用 NodeJS.ProcessEnv：它有 NODE_ENV 等必填项，测试里传部分配置会类型报错。
 */
export type EnvLike = Record<string, string | undefined>;

/**
 * 读环境变量决定 provider。
 * 未设 LLM_PROVIDER 时按 openai-compatible 处理（与旧行为一致：靠有没有 key 决定是否降级）。
 */
export function resolveProvider(env: EnvLike = process.env): LlmProvider {
  const raw = (env.LLM_PROVIDER || "").trim().toLowerCase();
  if (!raw) return "openai-compatible";
  if (raw === "mock") return "mock";
  if (raw === "openai-compatible" || raw === "openai" || raw === "deepseek") return "openai-compatible";
  throw new Error(
    `未知的 LLM_PROVIDER="${raw}"，可选值：mock / openai-compatible（留空默认 openai-compatible）`,
  );
}

export function createLlm(env: EnvLike = process.env): LlmPort {
  const provider = resolveProvider(env);

  if (provider === "mock") {
    return new MockLlm({
      // 默认脚本：一轮纯文本。演示时可用 LLM_MOCK_SCRIPT 覆盖成 JSON。
      script: parseMockScript(env.LLM_MOCK_SCRIPT),
      configured: true,
    });
  }

  return new OpenAiCompatibleLlm({
    baseUrl: env.LLM_BASE_URL || "https://api.deepseek.com",
    apiKey: env.LLM_API_KEY || "",
    model: env.LLM_MODEL || "deepseek-chat",
    extraBody: parseExtraBody(env.LLM_EXTRA_BODY),
  });
}

/**
 * 解析 `LLM_EXTRA_BODY`（JSON 对象字符串）→ 额外请求体字段。
 *
 * 用途：把 provider 私有参数（`thinking`、`reasoning_effort` 之类）挡在适配层里，
 * 应用层永远不需要知道背后是谁。典型配置：
 *   LLM_EXTRA_BODY={"thinking":{"type":"disabled"}}
 *
 * 解析失败**不抛错**，只 warn 并忽略：一个环境变量写错不该让整站聊天瘫痪。
 * 但也不能静默 —— 否则「为什么思考链没关掉」会查很久。
 */
export function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("必须是 JSON 对象");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.warn(`[llm] LLM_EXTRA_BODY 解析失败，已忽略：${(error as Error).message}`);
    return undefined;
  }
}

/**
 * 解析 LLM_MOCK_SCRIPT（JSON 数组），格式：[{"content":"...","toolCalls":[...]}]
 * 解析失败时退回单条默认回复，并打印警告 —— 演示现场不该因为环境变量写错就崩。
 */
function parseMockScript(raw: string | undefined): { content: string; toolCalls?: LlmReply["toolCalls"] }[] {
  if (!raw || !raw.trim()) return [{ content: "（演示模式）我可以帮你查时段、约时间。请告诉我想约哪个实验。" }];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    throw new Error("不是非空数组");
  } catch (error) {
    console.warn(`[llm] LLM_MOCK_SCRIPT 解析失败，使用默认脚本：${(error as Error).message}`);
    return [{ content: "（演示模式）我可以帮你查时段、约时间。" }];
  }
}

/** 进程内单例，避免每次都新建 */
let cached: { key: string; llm: LlmPort } | null = null;

/**
 * 取当前 LLM。
 * 缓存键包含影响实现的全部环境变量 —— 环境变了就重建，
 * 这样测试里改 env 不需要额外 reset 逻辑。
 */
export function getLlm(env: EnvLike = process.env): LlmPort {
  const key = [
    env.LLM_PROVIDER || "",
    env.LLM_BASE_URL || "",
    env.LLM_API_KEY || "",
    env.LLM_MODEL || "",
    env.LLM_MOCK_SCRIPT || "",
    env.LLM_EXTRA_BODY || "",
  ].join("|");

  if (cached && cached.key === key) return cached.llm;

  const llm = createLlm(env);
  cached = { key, llm };
  return llm;
}

/** 测试用：清掉单例缓存 */
export function resetLlmCache(): void {
  cached = null;
}

/** 测试用：直接暴露脚本解析逻辑 */
export const parseMockScriptForTest = parseMockScript;

export type { LlmMessage, LlmPort, LlmReply, LlmToolSpec };
export { OpenAiCompatibleLlm, MockLlm };
export type { ScriptedTurn } from "./mock";
