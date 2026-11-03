/**
 * Zod → JSON Schema（OpenAI function calling 用）的最小转换器。
 *
 * 为什么要自己写而不是引第三方：
 *   1. 只需要覆盖我们这个项目实际用到的子集（object/string/number/boolean/array/enum/optional/describe）
 *   2. 引第三方多一个依赖、多一份升级风险，而这里不到 100 行
 *   3. 单一事实源：工具的 Zod schema 同时用于「生成给模型的 JSON Schema」和「运行时校验参数」，
 *      不会出现两边不一致（手写 TOOLS 数组时这是常见 bug）
 *
 * 输出格式遵循 JSON Schema draft-07 的常见子集，OpenAI / DeepSeek 都能接受。
 */
import { z } from "zod";

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean;
};

/** 从 Zod 类型反推一个合法的空值，用于读取 `.default()` */
function readDefault(schema: z.ZodTypeAny): { has: boolean; value?: unknown } {
  if (schema instanceof z.ZodDefault) {
    return { has: true, value: (schema as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue() };
  }
  return { has: false };
}

/** 剥掉外壳（Optional / Default / Nullable），拿到内层实际类型 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  // 最多剥 5 层，防止环形定义死循环
  for (let i = 0; i < 5; i += 1) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodNullable
    ) {
      current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return current;
}

/** 单个 Zod 类型 → JsonSchema（不含 description，由外层补） */
function convert(schema: z.ZodTypeAny): JsonSchema {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodString) return { type: "string" };
  if (inner instanceof z.ZodNumber) return { type: "number" };
  if (inner instanceof z.ZodBoolean) return { type: "boolean" };
  if (inner instanceof z.ZodEnum) {
    // ZodEnum 的 options 在 _def.values
    const values = (inner as unknown as { _def: { values: unknown[] } })._def.values;
    return { type: "string", enum: values };
  }
  if (inner instanceof z.ZodArray) {
    return { type: "array", items: convert((inner as z.ZodArray<z.ZodTypeAny>)._def.type) };
  }
  if (inner instanceof z.ZodObject) {
    return objectSchema(inner as z.ZodObject<z.ZodRawShape>);
  }
  if (inner instanceof z.ZodLiteral) {
    const value = (inner as z.ZodLiteral<unknown>)._def.value;
    return { type: typeof value === "number" ? "number" : "string", enum: [value] };
  }

  // 兜底：不认识的类型一律当成「任意对象」，宁可模型自由发挥也不要崩
  return { type: "object", additionalProperties: true };
}

function objectSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const fieldSchema = field as z.ZodTypeAny;
    const converted = convert(fieldSchema);

    // Zod 的 description 挂在 _def.description 上（.describe("...") 设置的）
    const description = (fieldSchema as unknown as { _def: { description?: string } })._def.description;
    if (description) converted.description = description;

    const def = readDefault(fieldSchema);
    if (def.has) converted.default = def.value;

    properties[key] = converted;

    // 只有「非 Optional 且非 Default」才是必填
    const isOptional = fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault;
    if (!isOptional) required.push(key);
  }

  const out: JsonSchema = { type: "object", properties };
  if (required.length > 0) out.required = required;
  return out;
}

/**
 * 主入口：把工具参数 Zod object 转成 JSON Schema。
 * 不传 schema 的工具（无参数）会得到 `{ type: "object", properties: {} }`，
 * 与现在手写 TOOLS 里的写法完全一致。
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}
