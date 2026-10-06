"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PurchaseButton({
  planId,
  priceEg,
  owned,
}: {
  planId: string;
  priceEg: number;
  owned: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function purchase() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "حدث خطأ أثناء الاشتراك. حاول مرة أخرى.");
        return;
      }
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Link href="/redeem" className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
        Have a code? Redeem it · لديك كود؟ استخدمه
      </Link>
      <Button
        onClick={purchase}
        disabled={busy || owned}
        className="w-full"
        variant={owned ? "outline" : "default"}
      >
        {owned ? "مشترك بالفعل ✓" : busy ? "جارٍ الاشتراك..." : `اشترك الآن — ${priceEg} ج`}
      </Button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
