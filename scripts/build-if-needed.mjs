/**
 * 启动前确认有可用的构建产物：
 * 云端沙箱只跑 `npm start`（不会自动 build），本地重启也可能漏掉 build。
 * 已有 .next/BUILD_ID 就跳过，否则先 prisma generate 再 next build。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.log("[build] 已有构建产物，跳过");
  process.exit(0);
}

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
