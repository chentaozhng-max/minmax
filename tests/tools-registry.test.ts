import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry, type AgentTool, type ToolContext } from "@/tools/registry";

/**
 * 2.1 验证注册表：
 *   - 注册 / 重名 / 查找
 *   - specs() 生成 OpenAI 格式
 *   - exec() 的三重容错（未知工具 / 参数非法 / execute 抛错）全部转成 ok:false
 *   - sink 能被工具写入
 */

type Ctx = { greeting: string };

const echoTool: AgentTool<z.ZodObject<{ text: z.ZodString }>, Ctx> = {
  name: "echo",
  description: "原样回显",
  schema: z.object({ text: z.string().describe("要回显的文字") }),
  async execute({ ctx }, args) {
    return { ok: true, echo: args.text, greeting: ctx.greeting };
  },
};

const noArgTool: AgentTool<z.ZodObject<{}>, Ctx> = {
  name: "ping",
  description: "无参数工具",
  schema: z.object({}),
  async execute() {
    return { ok: true };
  },
};

const sinkTool: AgentTool<z.ZodObject<{ slotId: z.ZodString }>, Ctx> = {
  name: "book",
  description: "写 sink",
  schema: z.object({ slotId: z.string() }),
  async execute({ sink }, args) {
    sink.state = "BOOKED";
    sink.appointmentId = `apt-${args.slotId}`;
    return { ok: true };
  },
};

const boomTool: AgentTool<z.ZodObject<{}>, Ctx> = {
  name: "boom",
  description: "内部抛错",
  schema: z.object({}),
  async execute() {
    throw new Error("数据库炸了");
  },
};

function makeContext(): ToolContext<Ctx> {
  return { ctx: { greeting: "hi" }, sink: {}, now: new Date("2026-11-02T00:00:00.000Z") };
}

describe("注册与查找", () => {
  it("构造时可传入初始工具列表", () => {
    const reg = new ToolRegistry<Ctx>([echoTool, noArgTool]);
    expect(reg.names()).toEqual(["echo", "ping"]);
    expect(reg.has("echo")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("register 支持链式调用", () => {
    const reg = new ToolRegistry<Ctx>().register(echoTool).register(noArgTool);
    expect(reg.names()).toEqual(["echo", "ping"]);
  });

  it("重名注册抛错（构建期就该发现）", () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    expect(() => reg.register(echoTool)).toThrow(/工具名重复注册：echo/);
  });
});

describe("specs() 生成给模型的描述", () => {
  it("格式符合 OpenAI function calling 约定", () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    const specs = reg.specs();

    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe("function");
    expect(specs[0].function.name).toBe("echo");
    expect(specs[0].function.description).toBe("原样回显");
    expect(specs[0].function.parameters).toEqual({
      type: "object",
      properties: { text: { type: "string", description: "要回显的文字" } },
      required: ["text"],
    });
  });

  it("无参工具生成空 properties（与手写 TOOLS 一致）", () => {
    const reg = new ToolRegistry<Ctx>([noArgTool]);
    expect(reg.specs()[0].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("多个工具的 specs 顺序 = 注册顺序", () => {
    const reg = new ToolRegistry<Ctx>([echoTool, noArgTool, sinkTool]);
    expect(reg.specs().map((s) => s.function.name)).toEqual(["echo", "ping", "book"]);
  });
});

describe("exec() 正常路径", () => {
  it("执行工具并把 ctx 传进去", async () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    const result = await reg.exec("echo", { text: "你好" }, makeContext());
    expect(result).toEqual({ ok: true, echo: "你好", greeting: "hi" });
  });

  it("工具能写 sink，调用方能读到", async () => {
    const reg = new ToolRegistry<Ctx>([sinkTool]);
    const context = makeContext();
    await reg.exec("book", { slotId: "s1" }, context);
    expect(context.sink.state).toBe("BOOKED");
    expect(context.sink.appointmentId).toBe("apt-s1");
  });
});

describe("exec() 三重容错（都不抛异常，都返回 ok:false）", () => {
  it("未知工具", async () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    const result = await reg.exec("nope", {}, makeContext());
    expect(result).toEqual({ ok: false, error: "未知工具 nope" });
  });

  it("参数不合法 → 错误信息带字段路径", async () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    const result = await reg.exec("echo", { text: 123 }, makeContext());
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("参数不合法");
    expect(String(result.error)).toContain("text");
  });

  it("缺少必填参数 → 同样转成 ok:false", async () => {
    const reg = new ToolRegistry<Ctx>([echoTool]);
    const result = await reg.exec("echo", {}, makeContext());
    expect(result.ok).toBe(false);
  });

  it("工具内部抛错 → 被捕获成 ok:false，不打断对话", async () => {
    const reg = new ToolRegistry<Ctx>([boomTool]);
    const result = await reg.exec("boom", {}, makeContext());
    expect(result).toEqual({ ok: false, error: "数据库炸了" });
  });

  it("参数校验失败时 execute 绝不被调用", async () => {
    const spy = vi.fn(async () => ({ ok: true }));
    const tool: AgentTool<z.ZodObject<{ a: z.ZodString }>, Ctx> = {
      name: "spy",
      description: "d",
      schema: z.object({ a: z.string() }),
      execute: spy,
    };
    const reg = new ToolRegistry<Ctx>([tool]);
    await reg.exec("spy", { a: 1 }, makeContext());
    expect(spy).not.toHaveBeenCalled();
  });
});
