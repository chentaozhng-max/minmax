#!/usr/bin/env node
/**
 * check-layers.mjs — 分层依赖护栏
 *
 * 把 ARCHITECTURE.md 第 6 节的 L1–L7 变成可执行的检查。
 * 目的：防止"分层"只活在文档里，代码里悄悄把依赖方向倒回去。
 *
 * 用法：
 *   node scripts/check-layers.mjs             # 检查，违规 → 退出码 1
 *   node scripts/check-layers.mjs --baseline  # 把当前 L6 欠账写进基线文件
 *
 * 设计说明（重要）：
 * L1–L5 是硬性红线，一律报错。
 * L6/L7（"外部世界只在适配层"）在 Phase 4 之前必然大量违规——
 * 全站 100+ 处 prisma. 还在 route 和 server/ 里。一刀切会让护栏当场变废纸，
 * 所以对 L6 用「棘轮」策略：现状记进 .layer-baseline.json，只报**新增**违规。
 * Phase 4 每搬走一批就重跑 --baseline，基线只会变小，不会变大。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), process.env.LAYERS_ROOT ?? "src");
const BASELINE_FILE = path.resolve(process.cwd(), process.env.LAYERS_BASELINE ?? ".layer-baseline.json");
const WRITE_BASELINE = process.argv.includes("--baseline");

/* ---------------- 规则表 ---------------- */

// 依赖倒置的底线：领域层不许知道任何外部世界
const DOMAIN_FORBIDDEN = [
  /^@prisma\/client$/,
  /^next(\/|$)/,
  /^axios$/,
  /^openai$/,
  /^@\/adapters(\/|$)/,
  /^@\/application(\/|$)/,
  /^@\/server(\/|$)/,
  /^@\/app(\/|$)/,
  /^@\/lib(\/|$)/, // lib 是历史遗留的杂层，领域层不该反向依赖
  /^@\/tools(\/|$)/,
  /^@\/components(\/|$)/,
];

// 领域层只允许这些
const DOMAIN_ALLOWED = [/^zod$/, /^@\/domain(\/|$)/, /^node:/, /^\.\//, /^\.\.\//];

// 应用层只许 import type 端口，不许碰适配器实现 / Next / Prisma
const APP_FORBIDDEN_IMPL = [/^@\/adapters(\/|$)/, /^@prisma\/client$/, /^next(\/|$)/, /^@\/app(\/|$)/, /^@\/components(\/|$)/];

// 外部世界只能在适配层出现（L6 用棘轮：只报新增）
const EXTERNAL_SINKS = [
  { re: /\bprisma\.[a-zA-Z_$]/g, name: "prisma." },
  { re: /\$executeRaw\b/g, name: "$executeRaw" },
  { re: /\$queryRaw\b/g, name: "$queryRaw" },
  { re: /\bcookies\(\)/g, name: "cookies()" },
  { re: /\bfetch\(/g, name: "fetch(" },
];

const L5_MAX_HANDLER_LINES = 40;

/* ---------------- 采集 ---------------- */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;

function collectImports(src) {
  const hits = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const isTypeOnly = Boolean(m[1]);
    const spec = m[2];
    const idx = m.index ?? 0;
    const line = src.slice(0, idx).split("\n").length;
    hits.push({ spec, isTypeOnly, line });
  }
  return hits;
}

// 注意：ROOT 可被 LAYERS_ROOT 覆盖（测试用临时目录），
// 所以路径一律相对 ROOT 计算再补上 "src/" 前缀——不能用 cwd，
// 否则临时目录里的文件路径会变成 ../../Temp/...，规则表全部匹配不上而静默放行。
const rel = (p) => `src/${path.relative(ROOT, p).replace(/\\/g, "/")}`;

/* ---------------- 检查 ---------------- */

const violations = [];
const add = (file, line, rule, msg, hard = true) => violations.push({ file, line, rule, msg, hard });
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
const isCommentLine = (src, line) => /^\s*(\/\/|\*|\/\*)/.test(src.split("\n")[line - 1] ?? "");

const files = walk(ROOT);

for (const abs of files) {
  const file = rel(abs);
  const src = fs.readFileSync(abs, "utf8");
  const imports = collectImports(src);

  /* L1 / L2 — 领域层 */
  if (file.startsWith("src/domain/")) {
    for (const imp of imports) {
      if (DOMAIN_FORBIDDEN.some((re) => re.test(imp.spec))) {
        add(file, imp.line, "L1", `领域层禁止 import "${imp.spec}"（依赖倒置的底线）`);
      } else if (!DOMAIN_ALLOWED.some((re) => re.test(imp.spec))) {
        add(file, imp.line, "L2", `领域层只允许 zod / @/domain/* / node:*，实际 import 了 "${imp.spec}"`);
      }
    }
  }

  /* L3 / L4 — 应用层 */
  if (file.startsWith("src/application/")) {
    for (const imp of imports) {
      if (APP_FORBIDDEN_IMPL.some((re) => re.test(imp.spec))) {
        const rule = /^next(\/|$)/.test(imp.spec) ? "L4" : "L3";
        const why =
          rule === "L4"
            ? `应用层禁止 import "${imp.spec}"（HTTP 是适配细节）`
            : `应用层禁止 import 具体实现 "${imp.spec}"，只能 import type 端口接口`;
        add(file, imp.line, rule, why);
      }
    }
  }

  /* L6 — 外部世界只在适配层（棘轮：软性，允许基线内的历史欠账） */
  if (!file.startsWith("src/adapters/")) {
    for (const sink of EXTERNAL_SINKS) {
      for (const m of src.matchAll(sink.re)) {
        const line = lineOf(src, m.index ?? 0);
        if (isCommentLine(src, line)) continue;
        add(file, line, "L6", `"${sink.name}" 只能出现在 src/adapters/**`, false);
      }
    }
  }

  /* L7 — 工具层只编排，不直连数据库（硬性） */
  if (file.startsWith("src/tools/")) {
    for (const sink of EXTERNAL_SINKS.slice(0, 3)) {
      for (const m of src.matchAll(sink.re)) {
        const line = lineOf(src, m.index ?? 0);
        if (isCommentLine(src, line)) continue;
        add(file, line, "L7", `工具层禁止直接用数据库，改用注入的回调 / 端口`);
      }
    }
  }
}

/* ---------------- L5 — API 薄壳（按行数） ---------------- */

// 兼容两种写法：export async function GET(...) 和 export const GET = handle(...)
const HANDLER_RE = /^export\s+(?:(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|const\s+(GET|POST|PUT|PATCH|DELETE)\s*=)/;

for (const abs of files) {
  const file = rel(abs);
  if (!/^src\/app\/api\/.*route\.tsx?$/.test(file)) continue;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HANDLER_RE.exec(lines[i]);
    if (m) starts.push({ i, name: m[1] ?? m[2] });
  }
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    const len = end - starts[k].i;
    if (len > L5_MAX_HANDLER_LINES) {
      add(file, starts[k].i + 1, "L5", `${starts[k].name} 有 ${len} 行（上限 ${L5_MAX_HANDLER_LINES}）——route handler 应该是薄壳`, false);
    }
  }
}

/* ---------------- 棘轮：基线对比 ---------------- */

const key = (v) => `${v.file}|${v.rule}|${v.msg}`;

if (WRITE_BASELINE) {
  const soft = violations.filter((v) => !v.hard);
  const counts = {};
  for (const v of soft) counts[key(v)] = (counts[key(v)] ?? 0) + 1;
  fs.writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ note: "L5/L6 历史欠账基线。Phase 4 每搬走一批就重跑 --baseline，只许变小。", total: soft.length, counts }, null, 2) + "\n",
    "utf8",
  );
  console.log(`📝 基线已写入 .layer-baseline.json：${Object.keys(counts).length} 条 / 共 ${soft.length} 处欠账（L5+L6）`);
  process.exit(0);
}

let baseline = { counts: {} };
if (fs.existsSync(BASELINE_FILE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

const hard = violations.filter((v) => v.hard);
const softNow = violations.filter((v) => !v.hard);

const budget = { ...(baseline.counts ?? {}) };
const softNew = [];
for (const v of softNow) {
  const k = key(v);
  if ((budget[k] ?? 0) > 0) budget[k] -= 1;
  else softNew.push(v);
}

/* ---------------- 报告 ---------------- */

const total = hard.length + softNew.length;

if (total === 0) {
  const baseTotal = Object.values(baseline.counts ?? {}).reduce((a, b) => a + b, 0);
  const burned = baseTotal - softNow.length;
  const tail = burned > 0 ? `｜L6 欠账比基线少 ${burned} 处，可重跑 --baseline 收紧` : "";
  console.log(`✅ check-layers: ${files.length} 个文件通过（L1–L7）${tail}`);
  process.exit(0);
}

console.error(`❌ check-layers: ${total} 处违规（硬性 ${hard.length} / 新增 L6 ${softNew.length}）\n`);
for (const v of [...hard, ...softNew].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.msg}`);
}
console.error("\n规则说明见 ARCHITECTURE.md 第 6 节。");
process.exit(1);
