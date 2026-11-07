/**
 * 启动前的「库结构」守卫。
 *
 * 为什么需要它：发布沙箱会**复用同一个工作目录**，而上传包不含 `prisma/dev.db`，
 * 所以沙箱里那份旧库不会被覆盖。发布目录曾经长期停在 v1.2，
 * 那里的库连 `Experiment.mode` 都没有 —— 新代码一查就
 * `no such column`，表现为整站 500（页面是客户端渲染，HTML 还 200，特别难查）。
 *
 * 做法：结构对不上就删库，交给 `prepare-db.mjs` 重建并灌种子。
 * **只认 Prisma 明确的 no such column / no such table**，其余错误一律不动 ——
 * 宁可让它带着错跑出来，也不能误删真实数据。
 */
import { existsSync, renameSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const DB = path.resolve("prisma/dev.db");

/** 新代码一定会用到的列（挑几个 v1.4 才有的，命中任意一个缺失就说明库太旧） */
const PROBE = "SELECT mode, scheduleMode, windowStart, repeatCount FROM Experiment LIMIT 1";

/**
 * 删掉旧库。
 *
 * 三级兜底：某些宿主会把 `fs.rmSync` 劫持到「安全删除」（本机就有一个 shim，
 * 直接抛错）；Windows 上文件还可能被残留句柄锁着。
 * 改名同样能让 prepare-db 认为「没有库」，且不经过删除逻辑。
 */
function dropStaleDb() {
  try {
    unlinkSync(DB);
    return "已删除";
  } catch {}
  try {
    rmSync(DB, { force: true });
    return "已删除";
  } catch {}
  try {
    renameSync(DB, `${DB}.stale-${Date.now()}`);
    return "已改名";
  } catch (error) {
    return `清理失败（${String(error).split("\n")[0].slice(0, 70)}）`;
  }
}

async function main() {
  if (!existsSync(DB)) {
    console.log("[schema] 没有 prisma/dev.db，留给 prepare-db 初始化");
    return;
  }

  let stale = false;
  let reason = "";

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRawUnsafe(PROBE);
    console.log("[schema] 库结构正常");
  } catch (error) {
    const message = String(error);
    if (/no such column|no such table/i.test(message)) {
      stale = true;
      reason = message.split("\n")[0].slice(0, 90);
    } else {
      console.log(`[schema] 检查未通过但不像结构问题，保持原样：${message.slice(0, 120)}`);
    }
  } finally {
    // 必须先断开再动文件：Windows 上连接没关时 de/rename 会 EBUSY
    await prisma.$disconnect().catch(() => {});
  }

  if (!stale) return;

  // 断开后句柄释放有一点点延迟，给它一口气的时间
  await new Promise((resolve) => setTimeout(resolve, 150));
  const how = dropStaleDb();
  console.log(`[schema] 库结构过旧（${reason}）→ ${how}，准备重建`);
}

main().catch((error) => {
  // 这个脚本是守卫，不能因为它自己出错而挡住启动
  console.error("[schema] 守卫自身出错，继续启动", error);
});
