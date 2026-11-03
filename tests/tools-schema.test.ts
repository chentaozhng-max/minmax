import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "@/tools/schema";

/**
 * 2.2 验证 Zod → JSON Schema：
 * 生成的 schema 必须与现在手写 TOOLS 里的写法完全一致（否则模型行为会变）。
 */

describe("基础类型", () => {
  it("string / number / boolean", () => {
    const s = z.object({ a: z.string(), b: z.number(), c: z.boolean() });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } },
      required: ["a", "b", "c"],
    });
  });

  it("array of string（对应 slotIds）", () => {
    const s = z.object({ slotIds: z.array(z.string()) });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: { slotIds: { type: "array", items: { type: "string" } } },
      required: ["slotIds"],
    });
  });

  it("enum（字符串枚举）", () => {
    const s = z.object({ when: z.enum(["today", "tomorrow"]) });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: { when: { type: "string", enum: ["today", "tomorrow"] } },
      required: ["when"],
    });
  });

  it("literal", () => {
    const s = z.object({ kind: z.literal("slot") });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: { kind: { type: "string", enum: ["slot"] } },
      required: ["kind"],
    });
  });
});

describe("必填与可选", () => {
  it("optional 字段不进 required", () => {
    const s = z.object({ a: z.string(), b: z.string().optional() });
    const out = zodToJsonSchema(s);
    expect(out.required).toEqual(["a"]);
    expect(out.properties?.b).toEqual({ type: "string" });
  });

  it("带 default 的字段不进 required，且写出 default 值", () => {
    const s = z.object({ n: z.number().default(3) });
    const out = zodToJsonSchema(s);
    expect(out.required).toBeUndefined();
    expect(out.properties?.n).toEqual({ type: "number", default: 3 });
  });

  it("全部可选时没有 required 键（不是空数组）", () => {
    const s = z.object({ a: z.string().optional() });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });
});

describe("description 透传", () => {
  it("字段级 .describe() 变成 schema.description", () => {
    const s = z.object({ slotId: z.string().describe("被选中的时段 id") });
    const out = zodToJsonSchema(s);
    expect(out.properties?.slotId).toEqual({ type: "string", description: "被选中的时段 id" });
  });

  it("数组字段的 description 挂在外层而不是 items 上", () => {
    const s = z.object({ ids: z.array(z.string()).describe("时段 id 列表") });
    const out = zodToJsonSchema(s);
    expect(out.properties?.ids).toEqual({
      type: "array",
      items: { type: "string" },
      description: "时段 id 列表",
    });
  });
});

describe("嵌套与边界", () => {
  it("嵌套 object", () => {
    const s = z.object({ inner: z.object({ x: z.string() }) });
    expect(zodToJsonSchema(s)).toEqual({
      type: "object",
      properties: {
        inner: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
      },
      required: ["inner"],
    });
  });

  it("空 object（无参工具，对应 get_available_slots）", () => {
    expect(zodToJsonSchema(z.object({}))).toEqual({ type: "object", properties: {} });
  });

  it("nullable 被剥掉，只留内层类型", () => {
    const s = z.object({ a: z.string().nullable() });
    expect(zodToJsonSchema(s).properties?.a).toEqual({ type: "string" });
  });
});
