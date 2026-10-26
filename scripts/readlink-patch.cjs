/**
 * 本机 E: 盘的 readlink 对普通文件返回 EISDIR（正常 Windows 应该返回 EINVAL），
 * webpack / Next 的依赖快照把 EISDIR 当成崩溃，构建直接失败。
 * 这个补丁只把错误码改写成 EINVAL，语义仍是"这个路径不是符号链接"。
 *
 * 用法：NODE_OPTIONS="--require=E:/minmax/scripts/readlink-patch.cjs" npm run build
 */
const fs = require("node:fs");

function normalize(error) {
  if (error && (error.code === "EISDIR" || error.code === "EPERM")) {
    error.code = "EINVAL";
    error.errno = -4071;
    try {
      error.message = error.message.replace(/EISDIR|EPERM/, "EINVAL");
    } catch {
      /* message 可能只读，忽略 */
    }
  }
  return error;
}

const rawSync = fs.readlinkSync;
fs.readlinkSync = function readlinkSync(path, options) {
  try {
    return rawSync.call(fs, path, options);
  } catch (error) {
    throw normalize(error);
  }
};

const rawCallback = fs.readlink;
fs.readlink = function readlink(path, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? undefined : options;
  return rawCallback.call(fs, path, opts, (error, result) => {
    cb(normalize(error), result);
  });
};

if (fs.promises && fs.promises.readlink) {
  const rawPromise = fs.promises.readlink.bind(fs.promises);
  fs.promises.readlink = async function readlinkPromise(path, options) {
    try {
      return await rawPromise(path, options);
    } catch (error) {
      throw normalize(error);
    }
  };
}
