import { describe, expect, it } from "vitest";
import { diffUnread, unreadToastText } from "@/lib/unread-count";

describe("diffUnread", () => {
  it("首次加载（prev 为 null）不弹 —— 历史未读不该被当成新消息", () => {
    expect(diffUnread(null, 5)).toEqual({ notify: false, added: 0 });
  });

  it("数字变多 → 弹，added 是差值", () => {
    expect(diffUnread(2, 3)).toEqual({ notify: true, added: 1 });
    expect(diffUnread(0, 4)).toEqual({ notify: true, added: 4 });
  });

  it("数字没变 → 不弹（轮询最常见的情况，必须安静）", () => {
    expect(diffUnread(3, 3)).toEqual({ notify: false, added: 0 });
  });

  it("数字变小（用户点了全部已读）→ 不弹", () => {
    expect(diffUnread(5, 0)).toEqual({ notify: false, added: 0 });
    expect(diffUnread(5, 4)).toEqual({ notify: false, added: 0 });
  });

  it("从 0 变成 0 → 不弹", () => {
    expect(diffUnread(0, 0)).toEqual({ notify: false, added: 0 });
  });
});

describe("unreadToastText", () => {
  it("一条用单数，多条用数字", () => {
    expect(unreadToastText(1)).toBe("你有 1 条新的实验提醒");
    expect(unreadToastText(3)).toBe("你有 3 条新的实验提醒");
  });
});
