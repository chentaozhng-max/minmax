/**
 * 启动前确认有可用的构建产物：
 * 云端沙箱只跑 `npm start`（不会自动 build），本地重启也可能漏掉 build。
 *
 * 判断「要不要重新构建」看两件事：
 *   1) 必需产物是否齐全（构建中途失败会留下 BUILD_ID 但缺 manifest）；
 *   2) 源码是否比构建产物新——沙箱复用时会带着上一版 .next，
 *      只看产物在不在就会永远跳过构建，线上一直是老页面。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 只看 BUILD_ID 不够：构建中途失败时会留下 BUILD_ID 但缺 manifest，
 * `next start` 起来后每个请求都 500。这里把几个必需产物一起查。
 */
const REQUIRED = [
  "BUILD_ID",
  "build-manifest.json",
  "routes-manifest.json",
  "prerender-manifest.json",
  "server/app-paths-manifest.json",
];

/** 影响构建结果的源码位置，任意一个比 BUILD_ID 新就要重建 */
const SOURCES = [
  "src",
  "public",
  "prisma/schema.prisma",
  "package.json",
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  "tsconfig.json",
];

const SKIP_DIR = new Set(["node_modules", ".next", ".git", ".turbo"]);

/** 取一个路径（文件或目录）下最新的修改时间 */
function newestMtime(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

const missing = REQUIRED.filter((file) => !existsSync(path.join(root, ".next", file)));

let reason = "";
if (missing.length > 0) {
  reason = `构建产物不完整，缺 ${missing.join(", ")}`;
} else {
  const buildTime = statSync(path.join(root, ".next", "BUILD_ID")).mtimeMs;
  const newest = Math.max(...SOURCES.map((rel) => newestMtime(path.join(root, rel))));
  // 容 2 秒误差：解包 / 复制时文件时间容易被取整
  if (newest > buildTime + 2000) {
    const lag = Math.round((newest - buildTime) / 1000);
    reason = `源码比构建产物新 ${lag}s，重新构建`;
  }
}

if (!reason) {
  console.log("[build] 构建产物是最新的，跳过");
  process.exit(0);
}

console.log(`[build] ${reason}`);

function run(args, label) {
  console.log(`[build] ${label}…`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) {
    console.error(`[build] ${label} 失败`, result.error?.message ?? `退出码 ${result.status}`);
    process.exit(result.status || 1);
  }
}

run([path.join("node_modules", "prisma", "build", "index.js"), "generate"], "生成 Prisma Client");
run([path.join("scripts", "next-run.mjs"), "build", "--turbopack"], "构建 Next.js");
console.log("[build] 准备完成");
