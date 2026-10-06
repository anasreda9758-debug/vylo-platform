"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Preview = {
  valid: boolean;
  code: string;
  rewardType: string;
  benefit: string;
  accessUntil: string | null;
};

function formatInput(value: string) {
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  return normalized.match(/.{1,5}/g)?.join("-") ?? normalized;
}

export default function RedeemPage() {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(action: "preview" | "confirm") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, action }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to redeem code");
        if (action === "preview") setPreview(null);
        return;
      }
      if (action === "preview") setPreview(data);
      else setMessage("Code redeemed successfully.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Redeem your code</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter a VYLO code to preview the access or benefit it grants.</p>
        <input
          value={code}
          onChange={(event) => setCode(formatInput(event.target.value))}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
          className="mt-6 w-full rounded-lg border border-border bg-background px-3 py-3 font-mono text-sm tracking-wide"
          aria-label="Redeem code"
          autoCapitalize="characters"
        />
        <Button className="mt-3 w-full" onClick={() => void submit("preview")} disabled={busy || !code.trim()}>
          {busy ? "..." : "Redeem"}
        </Button>
        {preview ? (
          <div className="mt-5 rounded-lg bg-muted/50 p-4">
            <p className="text-xs font-semibold uppercase text-emerald-600">Code valid</p>
            <p className="mt-2 font-medium">{preview.benefit}</p>
            {preview.accessUntil ? <p className="mt-1 text-sm text-muted-foreground">Access until: {new Date(preview.accessUntil).toLocaleDateString("en-GB")}</p> : null}
            {["FREE_MODULE", "FREE_FULL_TERM", "FREE_PURCHASE"].includes(preview.rewardType) ? (
              <Button className="mt-4 w-full" onClick={() => void submit("confirm")} disabled={busy}>Confirm redemption</Button>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Continue to purchase to apply this discount.</p>
            )}
          </div>
        ) : null}
        {message ? <p className="mt-4 text-sm text-red-600">{message}</p> : null}
      </section>
    </main>
  );
}
