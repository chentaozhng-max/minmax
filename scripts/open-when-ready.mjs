/**
 * 等服务端口真正能响应之后，再打开浏览器。
 *
 * 以前启动脚本是「ping 5 秒 → start 网址」。`next start` 冷启动往往要 5 秒以上，
 * 浏览器就抢在前面打开了，用户看到的是「无法访问此网站」，很像是启动失败。
 * 这里改成轮询，直到 /api/health 或首页返回任意 HTTP 状态码才开浏览器。
 *
 * 用法：node scripts/open-when-ready.mjs http://localhost:3000 [超时秒数]
 */
import { spawn } from "node:child_process";

const url = process.argv[2] ?? "http://localhost:3000";
const timeoutSec = Number(process.argv[3] ?? 150);
const deadline = Date.now() + timeoutSec * 1000;

async function isUp() {
  try {
    // 只要 TCP 通了、有 HTTP 响应就算起来，4xx 也算（说明服务在跑）
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function openBrowser(target) {
  // shell 里交给 cmd 的 start，走系统默认浏览器；
  // 直接 spawn("cmd", ["/c","start","",url]) 在 Windows 上容易把空标题参数吞掉。
  spawn(`start "" "${target}"`, { shell: true, detached: true, stdio: "ignore" }).unref();
}

while (Date.now() < deadline) {
  if (await isUp()) {
    openBrowser(url);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error(`[open] 等了 ${timeoutSec} 秒服务还没就绪，浏览器没有打开。`);
process.exit(1);
