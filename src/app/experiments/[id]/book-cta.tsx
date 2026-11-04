import Link from "next/link";
import { Button } from "@/components/ui/button";

export function BookCta({  experimentId,
  disabled,
  disabledReason,
  existingAppointmentId,
  override,
}: {
  experimentId: string;
  disabled: boolean;
  disabledReason?: string;
  existingAppointmentId: string | null;
  /** 问卷流程会顶掉「立即预约」：先填问卷、等筛选、已完成 —— 三种都不是预约 */
  override?: { label: string; href?: string; disabled?: boolean; reason?: string } | null;
}) {
  if (existingAppointmentId) {
    return (
      <Link href="/appointments" className="block">
        <Button size="lg" block variant="outline">
          查看我的预约
        </Button>
      </Link>
    );
  }

  if (override) {
    if (override.disabled || !override.href) {
      return (
        <Button size="lg" block disabled title={override.reason}>
          {override.label}
        </Button>
      );
    }
    return (
      <Link href={override.href} className="block">
        <Button size="lg" block>
          {override.label}
        </Button>
      </Link>
    );
  }

  if (disabled) {
    return (
      <Button size="lg" block disabled title={disabledReason}>
        立即预约
      </Button>
    );
  }

  return (
    <Link href={`/experiments/${experimentId}/chat`} className="block">
      <Button size="lg" block>
        立即预约
      </Button>
    </Link>
  );
}
