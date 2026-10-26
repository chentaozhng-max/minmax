"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";
import { toast } from "@/components/toast";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="ghost"
      size="lg"
      block
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await postJson("/api/auth/logout");
          router.replace("/login");
        } catch (error) {
          toast(error instanceof Error ? error.message : "退出失败", "error");
          setLoading(false);
        }
      }}
    >
      退出登录
    </Button>
  );
}
