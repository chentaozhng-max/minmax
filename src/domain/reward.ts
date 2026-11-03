/**
 * 奖励金额的统一口径。
 *
 * 库里存的是 `Experiment.rewardText`（比如 `¥30`），这里负责把它读成"钱"：
 * 卡片、详情、预约列表都只管调这几个函数，不要自己拼字符串，
 * 免得改口径时漏掉某处又冒出「1 学分」这种旧说法。
 */

/** 从奖励文本里取金额（元）。旧数据里的「1 学分」不算金额，返回 null。 */
export function rewardYuan(text: string): number | null {
  if (/学分/.test(text)) return null;
  const digits = text.replace(/[^\d.]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** 展示用的金额：「¥30」；没有金额时老老实实说「面议」 */
export function rewardAmountText(text: string): string {
  const yuan = rewardYuan(text);
  if (yuan === null) return "面议";
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(2)}`;
}

/** 带口径的整句：「奖励 ¥30」，塞在一行小字里用这个 */
export function rewardLabel(text: string): string {
  return `奖励 ${rewardAmountText(text)}`;
}

/** 表单里的纯数字 → 存库文本。没填或填 0 返回空串，交给调用方拦。 */
export function toRewardText(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? `¥${value}` : "";
}
