/**
 * 启动前确保数据库可用：
 *   - prisma/dev.db 不存在（比如云端刚拉下来的干净副本）就建表 + 灌演示数据
 *   - .env 没带过来时兜底 DATABASE_URL，避免 prisma 直接报错
 * 本地已有 dev.db 时这一句瞬间返回，不影响启动速度。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";

// prisma 的 file:./xxx.db 是相对 schema 所在目录解析的
const dbFile = path.resolve(root, "prisma", process.env.DATABASE_URL.replace(/^file:/, ""));

if (existsSync(dbFile)) {
  console.log("[db] prisma/dev.db 已存在，跳过初始化");
  process.exit(0);
}

function run(args, label) {
  console.log(`[db] ${label}…`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) {
    console.error(`[db] ${label} 失败：`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[db] ${label} 退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run([path.join("node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate"], "建表");
run([path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "seed.ts")], "灌演示数据");

console.log("[db] 准备完成");
