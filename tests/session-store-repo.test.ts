import { describe, expect, it } from "vitest";
import { makeSessionStore } from "@/adapters/db/prisma/session-store-repo";

/**
 * 门厅会话仓储测试（假 client，只断言「发出去的查询长什么样」）。
 *
 * 这里刻意不测「查出来的结果对不对」—— 那是数据库的事。要守住的是：
 *   · 归属过滤进 where（否则等于没校验）
 *   · 活会话判定只用 endedAt，不用别的东西
 *   · 压缩后 messageCount 不被 messages.length 顶掉
 */

type Row = Record<string, any>;

function makeFake(rows: Row[] = []) {
  const calls: { op: string; args: any }[] = [];
  let seq = 0;

  const db = {
    assistantThread: {
      create: async (args: any) => {
        calls.push({ op: "create", args });
        const row = { id: `th_${++seq}`, ...args.data };
        rows.push(row);
        return row;
      },
      findFirst: async (args: any) => {
        calls.push({ op: "findFirst", args });
        return rows.find((r) => matches(r, args.where)) ?? null;
      },
      findUnique: async (args: any) => {
        calls.push({ op: "findUnique", args });
        return rows.find((r) => r.id === args.where.id) ?? null;
      },
      update: async (args: any) => {
        calls.push({ op: "update", args });
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
      updateMany: async (args: any) => {
        calls.push({ op: "updateMany", args });
        const hit = rows.filter((r) => matches(r, args.where));
        hit.forEach((r) => Object.assign(r, args.data));
        return { count: hit.length };
      },
    },
  };
  return { db, calls, rows };
}

/** 够用的 where 匹配（只实现本文件用到的操作符） */
function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "gte" in v) return row[k] >= v.gte;
    if (v && typeof v === "object" && "lt" in v) return row[k] < v.lt;
    return row[k] === v;
  });
}

const AT = new Date("2026-11-05T10:00:00.000Z");
const at = () => new Date(AT);

describe("makeSessionStore / create", () => {
  it("建新会话：messages 是空数组字符串，lastActiveAt 有值", async () => {
    const { db, calls } = makeFake();
    const rec = await makeSessionStore(db, at).create("sub_1");

    expect(rec.subjectId).toBe("sub_1");
    expect(rec.messages).toEqual([]);
    expect(rec.endedAt).toBeNull();
    expect(rec.sealedAt).toBeNull();
    expect(rec.lastActiveAt).toEqual(AT);
    expect(calls[0].args.data.lastActiveAt).toEqual(AT);
  });
});

describe("makeSessionStore / findOwned", () => {
  it("⚠️ subjectId 进 where —— 不是取回来再比对", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]" }]);
    await makeSessionStore(db, at).findOwned("th_1", "sub_1");

    expect(calls[0].op).toBe("findFirst");
    expect(calls[0].args.where).toEqual({ id: "th_1", subjectId: "sub_1" });
  });

  it("不属于自己 → null（和「不存在」同一个返回值）", async () => {
    const { db } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]" }]);
    expect(await makeSessionStore(db, at).findOwned("th_1", "sub_2")).toBeNull();
    expect(await makeSessionStore(db, at).findOwned("th_404", "sub_1")).toBeNull();
  });
});

describe("makeSessionStore / findActiveBySubject", () => {
  it("只认 endedAt IS NULL + 未空闲超时", async () => {
    const { db, calls } = makeFake([]);
    await makeSessionStore(db, at).findActiveBySubject("sub_1", new Date("2026-11-05T09:30:00.000Z"));

    expect(calls[0].args.where).toEqual({
      subjectId: "sub_1",
      endedAt: null,
      lastActiveAt: { gte: new Date("2026-11-05T09:30:00.000Z") },
    });
    expect(calls[0].args.orderBy).toEqual({ lastActiveAt: "desc" });
  });

  it("已结束的会话不会被当成活会话", async () => {
    const { db } = makeFake([
      { id: "th_1", subjectId: "sub_1", messages: "[]", endedAt: new Date("2026-11-05T09:00:00.000Z"), lastActiveAt: AT },
    ]);
    const got = await makeSessionStore(db, at).findActiveBySubject("sub_1", new Date(0));
    expect(got).toBeNull();
  });

  it("软结束的会话仍是「活」的（复活靠 sealedAt，不靠 endedAt）", async () => {
    const { db } = makeFake([
      { id: "th_1", subjectId: "sub_1", messages: "[]", endedAt: null, sealedAt: new Date("2026-11-05T09:55:00.000Z"), lastActiveAt: AT },
    ]);
    const got = await makeSessionStore(db, at).findActiveBySubject("sub_1", new Date(0));
    expect(got?.id).toBe("th_1");
    expect(got?.sealedAt).toEqual(new Date("2026-11-05T09:55:00.000Z"));
  });
});

describe("makeSessionStore / save", () => {
  it("落 messages + summary，并把 lastActiveAt 推到 now", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]", lastActiveAt: new Date(0) }]);
    await makeSessionStore(db, at).save("th_1", {
      messages: [{ role: "user", content: "你好", createdAt: AT.toISOString() }],
      summary: "条件：周三下午",
    });

    const data = calls[0].args.data;
    expect(JSON.parse(data.messages)).toHaveLength(1);
    expect(data.summary).toBe("条件：周三下午");
    expect(data.lastActiveAt).toEqual(AT);
  });

  it("⚠️ 没传 messageCount 就不动它（压缩后 messages 变短，别把审计信息写小）", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]", messageCount: 38 }]);
    await makeSessionStore(db, at).save("th_1", {
      messages: [{ role: "user", content: "压过的", createdAt: AT.toISOString() }],
      summary: null,
    });

    expect(calls[0].args.data).not.toHaveProperty("messageCount");
  });

  it("传了 messageCount 才写", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]" }]);
    await makeSessionStore(db, at).save("th_1", {
      messages: [],
      summary: null,
      messageCount: 40,
    });

    expect(calls[0].args.data.messageCount).toBe(40);
  });
});

describe("makeSessionStore / finalize & seal", () => {
  it("finalize 写 endedAt + outcome + outcomeRef", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]" }]);
    const rec = await makeSessionStore(db, at).finalize("th_1", "USER_DONE", "apt_9");

    expect(calls[0].args.data.endedAt).toEqual(AT);
    expect(calls[0].args.data.outcome).toBe("USER_DONE");
    expect(calls[0].args.data.outcomeRef).toBe("apt_9");
    expect(rec.endedAt).toEqual(AT);
  });

  it("⚠️ finalize 不写 outcomeRef 时落 null，不是残留旧值", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]", outcomeRef: "apt_old" }]);
    await makeSessionStore(db, at).finalize("th_1", "IDLE");

    expect(calls[0].args.data.outcomeRef).toBeNull();
  });

  it("seal 只写 sealedAt，不动 endedAt（软结束 ≠ 结束）", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]", endedAt: null }]);
    await makeSessionStore(db, at).seal("th_1");

    expect(calls[0].args.data.sealedAt).toEqual(AT);
    expect(calls[0].args.data).not.toHaveProperty("endedAt");
  });

  it("resume 把 sealedAt 清回 null", async () => {
    const { db, calls } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "[]", sealedAt: AT }]);
    await makeSessionStore(db, at).resume("th_1");

    expect(calls[0].args.data.sealedAt).toBeNull();
  });
});

describe("makeSessionStore / closeIdleBefore", () => {
  it("只扫活会话，标 IDLE，返回条数", async () => {
    const cutoff = new Date("2026-11-05T09:00:00.000Z");
    const { db, calls } = makeFake([
      { id: "th_old", subjectId: "s1", messages: "[]", endedAt: null, lastActiveAt: new Date("2026-11-05T08:00:00.000Z") },
      { id: "th_fresh", subjectId: "s2", messages: "[]", endedAt: null, lastActiveAt: AT },
      { id: "th_done", subjectId: "s3", messages: "[]", endedAt: AT, lastActiveAt: new Date(0) },
    ]);

    const n = await makeSessionStore(db, at).closeIdleBefore(cutoff);

    expect(n).toBe(1);
    expect(calls[0].args.where).toEqual({ endedAt: null, lastActiveAt: { lt: cutoff } });
    expect(calls[0].args.data.outcome).toBe("IDLE");
  });
});

describe("makeSessionStore / 脏数据容错", () => {
  it("不认识的 outcome 当 null，别穿透到业务层", async () => {
    const { db } = makeFake([
      { id: "th_1", subjectId: "sub_1", messages: "[]", outcome: "SOMETHING_ELSE" },
    ]);
    const rec = await makeSessionStore(db, at).findOwned("th_1", "sub_1");
    expect(rec?.outcome).toBeNull();
  });

  it("老数据缺 messageCount → 用 messages.length 兜底", async () => {
    const { db } = makeFake([
      {
        id: "th_1",
        subjectId: "sub_1",
        messages: JSON.stringify([
          { role: "user", content: "a", createdAt: AT.toISOString() },
          { role: "assistant", content: "b", createdAt: AT.toISOString() },
        ]),
      },
    ]);
    const rec = await makeSessionStore(db, at).findOwned("th_1", "sub_1");
    expect(rec?.messageCount).toBe(2);
  });

  it("messages 整个坏了 → 空数组，不抛", async () => {
    const { db } = makeFake([{ id: "th_1", subjectId: "sub_1", messages: "{坏" }]);
    const rec = await makeSessionStore(db, at).findOwned("th_1", "sub_1");
    expect(rec?.messages).toEqual([]);
  });
});
