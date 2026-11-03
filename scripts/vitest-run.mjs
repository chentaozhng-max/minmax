/**
 * 运行 vitest 的包装器：先摘掉 WorkBuddy 注入的文件系统 shim，再交给 vitest。
 *
 * 为什么需要：`npm test` 直接调 vitest，不经过 scripts/next-run.mjs，
 * 于是 NODE_OPTIONS 里的 shim 会原样带进测试进程。vitest 在收集 SSR 依赖时
 * 会往系统 Temp 目录写文件，这一步被 shim 转交给外部回收站程序，直接报
 *
 *   Error: EPERM: operation not permitted, open '...\Temp\...\ssr\...'
 *   at node-brokered-fs-shim.cjs
 *
 * 测试本身是通过的（exit 0），但会打印 "Vitest caught 1 unhandled error"，
 * 让人误以为有失败用例。
 *
 * 清理逻辑与 scripts/next-run.mjs 里的 stripFsShim 同源：只摘掉那一条
 * --require，其余 NODE_OPTIONS 原样保留；需要保留时设 KEEP_NODE_OPTIONS=1。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const vitestBin = path.join(root, "node_modules", "vitest", "vitest.mjs");

function stripFsShim(options) {
  if (process.env.KEEP_NODE_OPTIONS === "1") return options;
  return options
    .replace(/--require(?:=|\s+)["']?[^"'\s]*(?:node-language-shim|node-brokered-fs-shim)[^"'\s]*["']?/g, "")
    .trim();
}

const child = spawn(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
  env: {
    ...process.env,
    NODE_OPTIONS: stripFsShim(process.env.NODE_OPTIONS ?? ""),
    FORCE_COLOR: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
