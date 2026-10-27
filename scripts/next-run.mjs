/**
 * 启动 Next.js 的包装器：先预加载 readlink 补丁，再交给 next 官方 CLI。
 * 原因见 scripts/readlink-patch.cjs（本机 E: 盘的 readlink 返回 EISDIR，会让 webpack 崩）。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const patch = path.join(here, "readlink-patch.cjs");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const passed = process.argv.slice(2);

// 只有 dev / start 需要端口；build 传 -p 会被 next 拒绝。
// 云端沙箱会注入 PORT，本地默认 3000；已显式传 -p 时以传入的为准。
const needsPort = passed[0] === "dev" || passed[0] === "start";
const hasPort = passed.some((arg) => arg === "-p" || arg.startsWith("--port"));
if (needsPort && !hasPort) {
  passed.push("-p", String(process.env.PORT || 3000));
}

const args = ["-r", patch, nextBin, ...passed];

/**
 * WorkBuddy 的 shell 会在 NODE_OPTIONS 里注入一个文件系统 shim
 * （node-language-shim.cjs → node-brokered-fs-shim.cjs），它会把**删除**操作
 * 转交给一个回收站程序。Next 构建一开始要清空 .next（几十 MB、上万文件），
 * 回收站程序处理这种量级会 ETIMEDOUT，构建直接报
 * `[safe-delete] 操作失败: spawnSync ... ETIMEDOUT` 或半途 ENOENT。
 *
 * 这里只把这一条 --require 摘掉，其余 NODE_OPTIONS 原样保留。
 * 需要保留时设 KEEP_NODE_OPTIONS=1。
 */
function stripFsShim(options) {
  if (process.env.KEEP_NODE_OPTIONS === "1") return options;
  return options
    .replace(/--require(?:=|\s+)["']?[^"'\s]*(?:node-language-shim|node-brokered-fs-shim)[^"'\s]*["']?/g, "")
    .trim();
}

const child = spawn(process.execPath, args, {
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
