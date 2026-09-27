import { cn } from "@/lib/utils";

/**
 * VYLO brand mark.
 *
 * An original, dependency-free mark built from code. The motif is an open book
 * whose pages rise into three ascending nodes — a knowledge graph that reads as
 * "learning that connects" rather than anything clinical. It is intentionally
 * generic so the platform is not branded as medical-only.
 */
export function VyloMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label="VYLO"
      className={cn("h-8 w-8", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="vylo-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {/* open book: two pages meeting at a spine */}
      <path
        d="M20 15.5C16.9 12.9 12.6 12 8 12.6c-.7.1-1.2.7-1.2 1.4v14.2c0 .9.8 1.6 1.7 1.5 3.9-.2 7.7.6 10.6 2.7a1.1 1.1 0 0 0 1.8 0c2.9-2.1 6.7-2.9 10.6-2.7.9.1 1.7-.6 1.7-1.5V14c0-.7-.5-1.3-1.2-1.4-4.6-.6-8.9.3-12 2.9Z"
        fill="url(#vylo-mark)"
      />
      {/* ascending nodes above the book: the knowledge graph */}
      <circle cx="12" cy="8.5" r="2.1" fill="currentColor" opacity="0.9" />
      <circle cx="20" cy="5.4" r="2.4" fill="currentColor" />
      <circle cx="28" cy="8.5" r="2.1" fill="currentColor" opacity="0.9" />
      <path
        d="M13.6 7.6 17.7 6.2M22.3 6.2 26.4 7.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

/** Icon-only lockup, for tight spaces such as a collapsed sidebar. */
export function VyloIcon({ className }: { className?: string }) {
  return <VyloMark className={cn("h-6 w-6", className)} />;
}

/** Full lockup: mark + wordmark. */
export function VyloLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <VyloMark className="h-7 w-7 shrink-0" />
      {compact ? null : (
        <span className="text-lg font-bold tracking-tight">
          VYLO
          <span className="ms-1 align-middle text-[10px] font-medium text-muted-foreground">
            smart learning
          </span>
        </span>
      )}
    </span>
  );
}
