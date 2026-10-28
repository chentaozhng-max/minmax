/**
 * 没有 .env 就照 .env.example 复制一份。
 *
 * 为什么需要：`.env` 在 `.gitignore` 里，从 GitHub 下载的压缩包 / 新克隆的仓库都没有它。
 * 缺它的时候 Prisma 直接报
 *   P1012 Environment variable not found: DATABASE_URL
 * 于是 `npm run setup` 死在建库那一步，双击启动程序就是一句「启动失败」。
 *
 * `.env.example` 里的默认值（`DATABASE_URL="file:./dev.db"`）本来就够本地跑，
 * 所以复制过来是安全的：它不含任何真实密钥，只有示例用的 JWT 占位串。
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

if (existsSync(envPath)) process.exit(0);

if (!existsSync(examplePath)) {
  console.error("[env] 缺少 .env，也没有 .env.example，无法继续。");
  process.exit(1);
}

copyFileSync(examplePath, envPath);
console.log("[env] 没有 .env，已按 .env.example 生成一份（本地 SQLite 默认配置）");
console.log("[env] 里面的 JWT_SECRET 是示例值，只够本机试玩；对外发布前请换成随机长串。");
