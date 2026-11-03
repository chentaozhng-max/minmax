import { TabBar } from "@/components/tab-bar";

/**
 * 页面切换时的占位骨架。
 *
 * 为什么必须有：这几个页面是服务端组件，内容要等服务端渲染完才到。
 * 没有 loading.tsx 时，Next 会一直停在旧页面上——用户看到的就是
 * 「点了没反应」。有了它，点击的一瞬间就换成骨架，明确「正在加载」。
 *
 * 为什么带着 TabBar：底部导航目前是每个页面自己渲染的（不在 layout 里），
 * 骨架里不放的话，切页时导航栏会整条消失再出现，很难看，也点不了别处。
 *
 * 形状刻意做得中性（页头 + 一张卡 + 几行）：这份骨架会被同 segment 下的
 * 子页面复用（比如 /me/credit 也用 /me/loading.tsx），
 * 画成「我的」的样子会在信誉分明细页显得不对。
 */
export function PageSkeleton({ role }: { role: "SUBJECT" | "RESEARCHER" }) {
  return (
    <main className="shell tabbar-space">
      {/* 占位高度对齐 PageHeader 的 h-12，避免内容落地时整体跳一下 */}
      <div className="flex h-12 items-center border-b border-line px-4">
        <div className="skeleton h-4 w-16 rounded-[3px]" />
      </div>

      <div className="px-4 pt-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="skeleton skeleton-round h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-4 w-24 rounded-[3px]" />
              <div className="skeleton h-3 w-40 rounded-[3px]" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="skeleton h-5 w-8 rounded-[3px]" />
                <div className="skeleton h-2.5 w-12 rounded-[3px]" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="skeleton h-3.5 w-20 rounded-[3px]" />
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                <div className="skeleton h-4 w-8 shrink-0 rounded-[3px]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="skeleton h-3 w-32 rounded-[3px]" />
                  <div className="skeleton h-2.5 w-44 rounded-[3px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <TabBar role={role} />
    </main>
  );
}
