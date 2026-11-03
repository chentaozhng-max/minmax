/**
 * Prisma 实现：TransactionPort。
 *
 * 事务怎么开是适配层的事。领域层只看到 `runInTransaction(fn)`，
 * 不知道背后是 `prisma.$transaction`。
 *
 * 关键：事务内使用的仓储必须绑定到 `tx`，不能绑定到外面的 `prisma` ——
 * 否则占位成功但建单失败时，占位不会被回滚，等于漏掉一个名额。
 */
import { prisma } from "@/lib/prisma";
import type { RepositoryBundle, TransactionPort } from "@/domain/ports/repositories";
import { makeSlotRepository } from "./slot-repo";
import { makeAppointmentRepository } from "./appointment-repo";
import type { PrismaClientLike } from "./types";

/** 用给定的执行器（prisma 或 tx）造一组仓储 */
export function makeBundle(db: PrismaClientLike): RepositoryBundle {
  return {
    slots: makeSlotRepository(db),
    appointments: makeAppointmentRepository(db),
  };
}

export function makeUnitOfWork(client: PrismaClientLike = prisma as unknown as PrismaClientLike): TransactionPort {
  const outer = makeBundle(client);

  return {
    get slots() {
      return outer.slots;
    },
    get appointments() {
      return outer.appointments;
    },

    async runInTransaction(fn) {
      return (client as unknown as { $transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction(
        async (tx) => fn(makeBundle(tx as PrismaClientLike)),
      ) as never;
    },
  };
}
