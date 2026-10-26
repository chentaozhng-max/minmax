import { appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * 邮件发送。开发环境（未配置 SMTP）走 mock：验证码打印到控制台并追加到 mock-email.log。
 * 生产环境接真实 SMTP 时，只需在这里替换实现，调用方不变。
 */
export async function sendVerifyMail(to: string, code: string) {
  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  const line = `[${new Date().toISOString()}] to=${to} code=${code}\n`;

  if (!hasSmtp) {
    console.log(`[mail-mock] 教育邮箱验证码 → ${to} : ${code}`);
    try {
      await appendFile(path.join(process.cwd(), "mock-email.log"), line, "utf8");
    } catch (error) {
      console.warn("[mail-mock] 写入 mock-email.log 失败", error);
    }
    return { provider: "mock" as const };
  }

  // 真实 SMTP 实现留待部署阶段接入（避免开发环境引入额外依赖）
  console.log(`[mail] SMTP 已配置但未实现投递，验证码：${code}`);
  return { provider: "smtp-pending" as const };
}
