/**
 * 工具注册表 —— 给 agent 加能力的唯一入口。
 *
 * 设计要点：
 *   1. 一个工具 = 一个对象：name / description / schema(Zod) / execute
 *   2. Zod schema 是单一事实源：同时生成给模型的 JSON Schema 和运行时参数校验
 *   3. 加新能力 = 新建一个 tools/xxx.ts + 在 index.ts 里 register 一行，agent.ts 不用改
 *   4. 执行失败不抛异常，返回 { ok: false, error }，让模型自己决定怎么跟用户解释
 *
 * 上下文用泛型 `C`，注册表本身不认识 Context 的具体形状 —— 这样 registry 可以脱离
 * agent 单独测试，也不会反向依赖 server 层。
 */
import type { z } from "zod";
import type { LlmToolSpec } from "@/domain/ports/llm";

/** 工具统一返回形状 */
export type ToolResult = { ok: boolean } & Record<string, unknown>;

/**
 * 工具可写的会话状态。
 * 原来散在 execTool 各 case 里的 sink 现在显式声明，跨工具的时序约束能一眼看见。
 */
export type ToolSink = {
  state?: string;
  appointmentId?: string;
  bookedLabel?: string;
};

/** 工具执行时能拿到的一切 */
export type ToolContext<C> = {
  /** 业务上下文（实验、被试、当前时间等），由调用方准备 */
  ctx: C;
  /** 可写的会话状态 */
  sink: ToolSink;
  /** 当前时间，统一注入便于测试拨表 */
  now: Date;
};

/**
 * 一个 agent 工具。
 * execute 的 args 类型由 schema 自动推导 —— 写错字段名编译期就报。
 */
export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny, C = unknown> {
  name: string;
  description: string;
  schema: S;
  execute(context: ToolContext<C>, args: z.infer<S>): Promise<ToolResult>;
}

/** 任意工具（用于容器存储，擦除具体类型） */
export type AnyAgentTool<C = unknown> = AgentTool<z.ZodTypeAny, C>;

/**
 * 注册表。
 * 执行链路：模型返回 name+args → registry.exec() → Zod 校验 → execute()
 * 任一步失败都转成 { ok:false, error }，不向上抛，避免一次工具错误打断整轮对话。
 */
export class ToolRegistry<C = unknown> {
  private tools = new Map<string, AnyAgentTool<C>>();

  constructor(tools: AnyAgentTool<C>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  /** 注册一个工具。重名会抛错（构建期就该发现，不该留到运行期） */
  register(tool: AnyAgentTool<C>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具名重复注册：${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** 是否注册了某个工具 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 已注册的工具名（顺序 = 注册顺序，测试与调试用） */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /** 生成给模型的工具描述列表 */
  specs(): LlmToolSpec[] {
    return [...this.tools.values()].map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodSchemaToParameters(tool.schema),
      },
    }));
  }

  /**
   * 执行一次工具调用。
   * 期望内失败（未知工具 / 参数非法 / 工具自身返回 ok:false）都当作正常返回值。
   */
  async exec(name: string, args: Record<string, unknown>, context: ToolContext<C>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: `未知工具 ${name}` };
    }

    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      // 把 Zod 的报错压成一句话，模型看得懂也便于日志排查
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      return { ok: false, error: `参数不合法（${detail}）` };
    }

    try {
      return await tool.execute(context, parsed.data);
    } catch (error) {
      // 工具内部抛异常（比如数据库炸了）不应该打断整轮对话
      const message = error instanceof Error ? error.message : "工具执行失败";
      return { ok: false, error: message };
    }
  }
}

/**
 * 单独抽出 Zod → parameters 的调用，避免 registry 直接依赖 schema.ts 的实现细节。
 * （放在这里做一层薄封装，将来换转换库只改这一处）
 */
import { zodToJsonSchema } from "./schema";

function zodSchemaToParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema) as Record<string, unknown>;
}
