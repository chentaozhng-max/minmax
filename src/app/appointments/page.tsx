import { requirePage } from "@/lib/page-auth";
import { AppointmentsView } from "./appointments-view";
import { parseAppointmentsTab } from "./tabs";

/**
 * 「我的预约」。
 *
 * `?tab=` 深链：从「我的」页的四格统计点进来时直接落在对应分栏，
 * 否则用户点「已完成 3」落到「待确认」还得自己再点一次 —— 那这个数字就白点了。
 *
 * 参数在这里解析（而不是丢给客户端组件）有个额外好处：
 * 非法值在服务端就归一成 `pending`，不会把 `?tab=<script>` 之类原样塞进 DOM。
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requirePage("SUBJECT");
  const sp = await searchParams;
  return <AppointmentsView initialTab={parseAppointmentsTab(sp.tab)} />;
}
