"use client";

/**
 * Spotter arrow. The TIP is the bottom-center of the SVG box, so parents
 * anchor it with translate(-50%, -100%) at the normalized target point.
 */
export function PracticalTargetArrow({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size + 8} viewBox="0 0 24 32" fill="none" aria-hidden="true" className={className}>
      <path d="M12 32 3 18h6V2h6v16h6Z" fill="#dc2626" stroke="#ffffff" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}