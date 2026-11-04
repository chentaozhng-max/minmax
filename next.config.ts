import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * 父目录 E:\minmax 里也有 package-lock.json（1.2 的旧项目），
   * Next 会按「最近的 lockfile」推断工作区根，结果选到了父目录，于是
   *   - 每次构建都警告 "inferred your workspace root"
   *   - 文件追踪范围变成整个上层目录，构建变慢、产物变大
   * 这里显式钉住本项目根。process.cwd() 可靠，是因为 scripts/next-run.mjs
   * 启动子进程时把 cwd 固定成了项目根。
   */
  outputFileTracingRoot: process.cwd(),

  /**
   * 文档解析库只在服务端用，不参与打包：
   *   unpdf 内部带 pdfjs 的 worker，xlsx 体积大且用了 Node 的 fs，
   *   mammoth 依赖 jszip。交给 Node 直接 require 最稳，也避免 Turbopack
   *   把它们当成客户端模块去解析。
   */
  serverExternalPackages: ["mammoth", "xlsx", "unpdf"],

  experimental: {
    /**
     * 客户端路由缓存（Next 15 起默认是 0 秒）。
     *
     * 默认值意味着：底部 5 个 tab 每点一次都重新向服务端要一次整页，
     * 用户「首页 → 我的预约 → 我的」这样来回切，每次都走一遍网络 + 渲染。
     * 服务端一旦冷启动（这套部署在云端空闲后首次请求要 5 秒），
     * 点 tab 就是「按了没反应」——这不是卡死，是在等服务端。
     *
     * 30 秒是权衡：够覆盖来回切 tab 的节奏，又不至于让信誉分、待确认数
     * 这类会变的数据长时间停在旧值。要更实时的页面（消息、聊天）
     * 自己用 react-query 轮询，不受这里影响。
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
