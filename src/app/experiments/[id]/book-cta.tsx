import Link from "next/link";
import { Button } from "@/components/ui/button";

export function BookCta({  experimentId,
  disabled,
  disabledReason,
  existingAppointmentId,
}: {
  experimentId: string;
  disabled: boolean;
  disabledReason?: string;
  existingAppointmentId: string | null;
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
