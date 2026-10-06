import { cn } from "@/lib/utils";

/**
 * VYLO brand mark.
 *
 * VYLO learning mark: a warm lightbulb with a graduation cap and rays.
 * It remains dependency-free and scales cleanly because it is drawn as SVG.
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
      {/* bulb */}
      <path d="M20 9.5c-7 0-11.5 5.1-10.2 11.3.6 2.8 2.3 4.5 4.5 6.1 1.2.9 1.8 2 1.9 3.5h7.6c.1-1.5.7-2.6 1.9-3.5 2.2-1.6 3.9-3.3 4.5-6.1C31.5 14.6 27 9.5 20 9.5Z" fill="#F4C542" />
      <path d="M16.1 30.4h7.8M16.8 34h6.4" stroke="#8C949E" strokeWidth="2.2" strokeLinecap="round" />
      {/* graduation cap */}
      <path d="m6.2 10.2 13.8-5.1 13.8 5.1L20 15.3 6.2 10.2Z" fill="#243B72" />
      <path d="M11.1 12.2v5.1c2.8 2.3 5.8 3.4 8.9 3.4s6.1-1.1 8.9-3.4v-5.1L20 15.3l-8.9-3.1Z" fill="#1A2E5B" />
      <path d="M33.8 10.2v7.2" stroke="#243B72" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="33.8" cy="19.4" r="1.5" fill="#243B72" />
      {/* bulb filament */}
      <path d="M15.2 15.8c0 3.1 2.4 5.8 4.8 7.7 2.4-1.9 4.8-4.6 4.8-7.7M15.2 15.8c0 2 1.3 3.1 3 3.1s3-1.1 3-3.1M21.2 15.8c0 2 1.3 3.1 3 3.1s3-1.1 3-3.1" fill="none" stroke="#FFFDF5" strokeWidth="1.8" strokeLinecap="round" />
      {/* light rays */}
      <path d="M5.7 16.8 3.5 15.5M5.7 23.1 3.5 24.4M34.3 16.8l2.2-1.3M34.3 23.1l2.2 1.3" stroke="#E7B62D" strokeWidth="1.8" strokeLinecap="round" />
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
