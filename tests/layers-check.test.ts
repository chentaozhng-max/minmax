import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 护栏脚本自己的测试。
 *
 * 一个检查分层的脚本，如果它自己坏了（正则失效、规则表被改空），
 * 它会「静默通过」——那比没有护栏更糟：你以为有锁，其实门开着。
 * 所以这里用临时目录造「故意的违规」，验证它真的会失败。
 */

const SCRIPT = path.resolve(process.cwd(), "scripts/check-layers.mjs");

function runLayers(root: string, baseline: string, extraArgs: string[] = []) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...extraArgs], {
      env: { ...process.env, LAYERS_ROOT: root, LAYERS_BASELINE: baseline },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

let workdir: string;

function scaffold(files: Record<string, string>) {
  const root = path.join(workdir, Math.random().toString(36).slice(2));
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return { root, baseline: path.join(root, ".baseline.json") };
}

const filler = (n: number) => Array.from({ length: n }, (_, i) => `  // filler ${i}`).join("\n");

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "layers-"));
});

afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("L1 — 领域层不许依赖外部世界", () => {
  it.each([
    ["@prisma/client", `import { PrismaClient } from "@prisma/client";`],
    ["next/server", `import { NextResponse } from "next/server";`],
    ["@/adapters/llm", `import { getLlm } from "@/adapters/llm";`],
  ])("domain 里 import %s → 报 L1", (_name, imp) => {
    const { root, baseline } = scaffold({ "domain/bad.ts": `${imp}\nexport const x = 1;\n` });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L1]");
  });
});

describe("L2 — 领域层白名单", () => {
  it("import 白名单外的第三方包 → 报 L2", () => {
    const { root, baseline } = scaffold({ "domain/bad.ts": `import _ from "lodash";\nexport const x = 1;\n` });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L2]");
  });

  it("只 import zod + 相对路径 → 通过", () => {
    const { root, baseline } = scaffold({
      "domain/ok.ts": `import { z } from "zod";\nimport { other } from "./other";\nexport const x = z.string();\n`,
      "domain/other.ts": `export const other = 1;\n`,
    });
    expect(runLayers(root, baseline).code).toBe(0);
  });
});

describe("L3 / L4 — 应用层只依赖抽象", () => {
  it("import 适配器实现 → 报 L3", () => {
    const { root, baseline } = scaffold({ "application/bad.ts": `import { getLlm } from "@/adapters/llm";\n` });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L3]");
  });

  it("import next/headers → 报 L4", () => {
    const { root, baseline } = scaffold({ "application/bad.ts": `import { cookies } from "next/headers";\n` });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L4]");
  });
});

describe("L5 — route handler 必须薄", () => {
  it("60 行 function POST → 报 L5", () => {
    const { root, baseline } = scaffold({
      "app/api/x/route.ts": `export async function POST() {\n${filler(58)}\n}\n`,
    });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L5]");
  });

  it("export const GET = handle(...) 写法也按行数检查", () => {
    const { root, baseline } = scaffold({
      "app/api/x/route.ts": `export const GET = handle(async () => {\n${filler(58)}\n});\n`,
    });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L5]");
  });

  it("10 行 handler → 通过", () => {
    const { root, baseline } = scaffold({
      "app/api/x/route.ts": `export async function GET() {\n  return ok();\n}\n`,
    });
    expect(runLayers(root, baseline).code).toBe(0);
  });
});

describe("L6 — 外部世界只在适配层（棘轮）", () => {
  it("adapters 里 prisma. 不报；server/ 里报", () => {
    const { root, baseline } = scaffold({
      "adapters/db/x.ts": `export const f = (prisma: any) => prisma.user.findMany();\n`,
      "server/y.ts": `export const g = (prisma: any) => prisma.user.findMany();\n`,
    });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("server/y.ts");
    expect(r.out).not.toContain("adapters/db/x.ts");
  });

  it("写基线后通过；新增一处才报", () => {
    const { root, baseline } = scaffold({
      "server/y.ts": `export const g = (prisma: any) => prisma.user.findMany();\n`,
    });
    expect(runLayers(root, baseline, ["--baseline"]).code).toBe(0);
    expect(runLayers(root, baseline).code).toBe(0);

    fs.writeFileSync(path.join(root, "server/z.ts"), `export const h = (prisma: any) => prisma.slot.count();\n`, "utf8");
    const r2 = runLayers(root, baseline);
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("server/z.ts");
  });

  it("注释里提到 prisma. 不算违规", () => {
    const { root, baseline } = scaffold({ "server/ok.ts": `// TODO: 以后用 prisma.user 查\nexport const x = 1;\n` });
    expect(runLayers(root, baseline).code).toBe(0);
  });
});

describe("L7 — 工具层不直连数据库", () => {
  it("tools 里 prisma. → 报 L7，且不能被基线豁免", () => {
    const { root, baseline } = scaffold({ "tools/bad.ts": `export const t = (prisma: any) => prisma.slot.findMany();\n` });
    const r = runLayers(root, baseline);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[L7]");
  });
});

describe("自身健康度", () => {
  it("脚本真的扫到了文件（防正则失效后静默通过）", () => {
    const { root, baseline } = scaffold({ "domain/a.ts": `export const x = 1;\n` });
    expect(runLayers(root, baseline).out).toContain("1 个文件");
  });
});
