/** Lawleit brand components — logo, wordmarks, small shared bits. */

export function GemMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  // Faceted lawleit gem: elongated hexagonal crystal with three facets
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M16 2 L27 12 L16 30 L5 12 Z" fill="currentColor" opacity="0.16" />
      <path d="M16 2 L27 12 L16 15 Z" fill="currentColor" opacity="0.55" />
      <path d="M27 12 L16 15 L16 30 Z" fill="currentColor" opacity="0.85" />
      <path d="M5 12 L16 15 L16 30 Z" fill="currentColor" opacity="0.35" />
      <path d="M16 2 L16 15 L5 12 Z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

export function Logo({
  className = "",
  light = false,
  size = "md",
}: {
  className?: string;
  light?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const text = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";
  return (
    <span className={`inline-flex items-center gap-1.5 font-extrabold tracking-tight ${text} ${className}`}>
      <GemMark size={size === "lg" ? 34 : size === "sm" ? 22 : 28} className={light ? "text-lawleit-band" : "text-lawleit"} />
      <span className={light ? "text-white" : "text-foreground"}>Lawleit</span>
    </span>
  );
}

/** Family wordmarks for the footer / utility bar (rebrand of the 8am product family) */
export function FamilyWordmark({ product, light = true }: { product: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-baseline text-[26px] font-bold tracking-tight ${light ? "text-white" : "text-foreground"}`}>
      <span className="text-lawleit-band mr-0.5">Lawleit</span>
      <span className="font-semibold">{product}</span>
    </span>
  );
}

export function CheckBadge({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#4B4ACF" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
