/**
 * 第二批页面查询测试共用的假 Prisma 客户端。
 *
 * 每个方法都往 log 里记一条 {op, args}，让用例能断言**查询形状**——
 * 这批重构承诺的是行为零变化，args 一改就是行为变了。
 */

import type { PageQueryClientLike } from "@/adapters/db/prisma/types";

export type Log = { op: string; args: any }[];

export function makeFakeDb(overrides: Record<string, any> = {}) {
  const log: Log = [];
  const db = {
    user: {
      findUnique: async (args: any) => {
        log.push({ op: "user.findUnique", args });
        return overrides.user ?? null;
      },
    },
    creditEvent: {
      findMany: async (args: any) => {
        log.push({ op: "creditEvent.findMany", args });
        return overrides.creditEvents ?? [];
      },
      findUnique: async (args: any) => {
        log.push({ op: "creditEvent.findUnique", args });
        return overrides.creditEvent ?? null;
      },
      count: async (args: any) => {
        log.push({ op: "creditEvent.count", args });
        return overrides.creditEventCount ?? 0;
      },
    },
    appointment: {
      findUnique: async (args: any) => {
        log.push({ op: "appointment.findUnique", args });
        return overrides.appointmentFull ?? null;
      },
      findFirst: async (args: any) => {
        log.push({ op: "appointment.findFirst", args });
        return overrides.myAppointment ?? null;
      },
      findMany: async (args: any) => {
        log.push({ op: "appointment.findMany", args });
        return overrides.appointments ?? [];
      },
      create: async () => ({}),
      update: async () => ({}),
      groupBy: async () => [],
      count: async (args: any) => {
        log.push({ op: "appointment.count", args });
        return overrides.appointmentCount ?? 0;
      },
    },
    chatSession: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
    },
    experiment: {
      findUnique: async (args: any) => {
        log.push({ op: "experiment.findUnique", args });
        return overrides.experiment ?? null;
      },
      count: async (args: any) => {
        log.push({ op: "experiment.count", args });
        return overrides.experimentCount ?? 0;
      },
    },
  } as unknown as PageQueryClientLike;
  return { db, log };
}

/** 主试带一堆不该外泄的字段 */
export const rawResearcher = {
  id: "r_1",
  name: "陈砚",
  school: "华东师范大学",
  department: "心理与认知科学学院",
  studentVerified: true,
  creditScore: 100,
  noShowCount: 0,
  phone: "13800000001",
  passwordHash: "$2b$10$leak",
  eduEmail: "chenyan@psy.ecnu.edu.cn",
  studentId: "2019001",
  refreshToken: "rt_leak",
};
