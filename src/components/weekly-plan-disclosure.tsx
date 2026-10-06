"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function WeeklyPlanDisclosure({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      if (location.hash === "#weekly-plan" && ref.current)
        ref.current.open = true;
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return (
    <details
      ref={ref}
      id="weekly-plan"
      className="group scroll-mt-20 rounded-xl border bg-card"
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:px-6">
        {label}
        <span
          aria-hidden="true"
          className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          ⌄
        </span>
      </summary>
      <div className="px-3 pb-3 sm:px-4">{children}</div>
    </details>
  );
}
