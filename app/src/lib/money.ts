/**
 * Money — the single currency module for Lawleit.
 *
 * All money in the system is integer paise (₹1 = 100 paise). Every formatter
 * and parser lives here; components must not render currency inline. The
 * data layer stores paise verbatim (REST contract keeps the same field
 * names), so conversions happen only at human input points.
 */

/** Integer paise. 100000 = ₹1,000. All money fields and arithmetic use this unit. */
export type Paise = number;

/** Rupees (possibly fractional) → integer paise, rounded. Use at every user-typed rupee input. */
export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/** Integer paise → rupees, for number inputs that collect rupees from the user. */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const formatter = (decimals: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Format an integer-paise amount with Indian digit grouping: 15000000 → "₹1,50,000.00".
 * Null/undefined/NaN render as "—" so optional fields degrade gracefully.
 */
export function formatINR(paise: number | null | undefined, opts?: { decimals?: 0 | 2 }): string {
  if (paise == null || Number.isNaN(paise)) return "—";
  return formatter(opts?.decimals ?? 2).format(paiseToRupees(paise));
}

/** Whole-rupee variant for rates and compact tiles: 15000000 → "₹1,50,000". */
export function formatINR0(paise: number | null | undefined): string {
  return formatINR(paise, { decimals: 0 });
}

/** Parse a typed amount ("₹1,50,000.50", "150000.5", " 1,000 ") into integer paise; null when not numeric. */
export function parseINRToPaise(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return rupeesToPaise(Number(cleaned));
}
