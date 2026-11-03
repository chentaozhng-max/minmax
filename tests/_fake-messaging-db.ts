/**
 * 私信端口测试用的假 Prisma。
 *
 * 手写而不是 mock 库：能写出假实现本身就是解耦的证明。
 * 每个方法往 log 记一条，用例据此断言**查询形状**（这批重构承诺行为零变化）。
 */
import type { MessagingClientLike } from "@/adapters/db/prisma/types";

export type Log = { op: string; args: any }[];

/**
 * 模拟 Prisma 的 `select` 投影。
 *
 * 这一步很关键：如果不投影，假 db 会把手写的完整对象原样吐回来，
 * 「适配器有没有真的收窄字段」这件事就测不出来 —— 用例会假绿。
 */
function project(row: any, args: any) {
  if (!row || !args?.select) return row;
  const out: any = {};
  for (const k of Object.keys(args.select)) {
    if (args.select[k]) out[k] = row[k];
  }
  return out;
}

export function makeFakeDb(overrides: Record<string, any> = {}) {
  const log: Log = [];

  const db = {
    user: {
      findUnique: async (args: any) => {
        log.push({ op: "user.findUnique", args });
        return project(overrides.researcher ?? null, args);
      },
    },
    experiment: {
      findUnique: async () => null,
      count: async () => 0,
      findMany: async (args: any) => {
        log.push({ op: "experiment.findMany", args });
        return overrides.experiments ?? [];
      },
    },
    directThread: {
      findUnique: async (args: any) => {
        log.push({ op: "directThread.findUnique", args });
        const row = args?.where?.subjectId_researcherId
          ? overrides.threadFull
          : overrides.threadFull ?? null;
        return project(row ?? null, args);
      },
      findMany: async (args: any) => {
        log.push({ op: "directThread.findMany", args });
        if (args?.select) return (overrides.threadIds ?? []).map((r: any) => project(r, args));
        return overrides.threads ?? [];
      },
      create: async (args: any) => {
        log.push({ op: "directThread.create", args });
        return overrides.createdThread ?? { id: "t_new" };
      },
      update: async (args: any) => {
        log.push({ op: "directThread.update", args });
        return { id: "t_1" };
      },
    },
    directMessage: {
      findMany: async (args: any) => {
        log.push({ op: "directMessage.findMany", args });
        return overrides.messages ?? [];
      },
      create: async (args: any) => {
        log.push({ op: "directMessage.create", args });
        return overrides.createdMessage ?? null;
      },
      updateMany: async (args: any) => {
        log.push({ op: "directMessage.updateMany", args });
        return overrides.updatedCount ?? 0;
      },
      count: async (args: any) => {
        log.push({ op: "directMessage.count", args });
        return overrides.unreadCount ?? 0;
      },
      groupBy: async (args: any) => {
        log.push({ op: "directMessage.groupBy", args });
        return overrides.unreadRows ?? [];
      },
    },
    // 事务：直接把 tx 当成同一个假 db 传进去，够用来验证「事务内调了哪些方法」
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      log.push({ op: "$transaction", args: null });
      return fn(db);
    },
  } as unknown as MessagingClientLike;

  return { db, log };
}

const subject = {
  id: "s_1",
  name: "林小满",
  school: "北京师范大学",
  department: "心理学部",
  studentVerified: true,
  creditScore: 96,
  passwordHash: "$2b$10$leak",
  eduEmail: "lin@bnu.edu.cn",
  phone: "13900000002",
};

const researcher = {
  id: "r_1",
  name: "陈砚",
  school: "华东师范大学",
  department: "心理与认知科学学院",
  studentVerified: true,
  creditScore: 100,
  passwordHash: "$2b$10$leak",
  eduEmail: "chenyan@psy.ecnu.edu.cn",
  refreshToken: "rt_leak",
};

/** 一条完整线程（含两颗整行 User —— 用来验证适配器有没有收窄） */
export const rawThreadFull = {
  id: "t_1",
  subjectId: "s_1",
  researcherId: "r_1",
  experimentId: "e_1",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  lastMessageAt: new Date("2026-10-02T00:00:00Z"),
  subject,
  researcher,
};

/** 消息列表页的一行（含 messages 数组，模拟 take:1 的 include 结果） */
export const rawThreadRow = {
  id: "t_1",
  subjectId: "s_1",
  researcherId: "r_1",
  experimentId: "e_1",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  lastMessageAt: new Date("2026-10-02T00:00:00Z"),
  subject,
  researcher,
  messages: [
    { content: "周五下午方便吗？", createdAt: new Date("2026-10-02T00:00:00Z"), senderId: "r_1" },
  ],
};

export const rawMessage = {
  id: "m_1",
  threadId: "t_1",
  senderId: "r_1",
  content: "周五下午方便吗？",
  createdAt: new Date("2026-10-02T00:00:00Z"),
};
