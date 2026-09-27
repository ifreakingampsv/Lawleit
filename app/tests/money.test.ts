import { describe, expect, it } from "vitest";
import { formatINR, formatINR0, parseINRToPaise, paiseToRupees, rupeesToPaise } from "@/lib/money";

/**
 * Unit tests for the money module — the only place currency is formatted.
 * All amounts are integer paise (100000 = ₹1,000); en-IN gives Indian digit
 * grouping (1,50,000 not 150,000).
 */
describe("formatINR", () => {
  it("formats integer paise as rupees with paise decimals", () => {
    expect(formatINR(15000000)).toBe("₹1,50,000.00");
    expect(formatINR(100000)).toBe("₹1,000.00");
    expect(formatINR(159500)).toBe("₹1,595.00");
    expect(formatINR(0)).toBe("₹0.00");
  });

  it("groups digits the Indian way (last group of 3, then 2s)", () => {
    expect(formatINR(10000000)).toBe("₹1,00,000.00");
    expect(formatINR(123456789)).toBe("₹12,34,567.89");
    expect(formatINR(100000000)).toBe("₹10,00,000.00");
  });

  it("supports whole-rupee output for rates and tiles", () => {
    expect(formatINR(300000, { decimals: 0 })).toBe("₹3,000");
    expect(formatINR0(300000)).toBe("₹3,000");
    expect(formatINR0(15000000)).toBe("₹1,50,000");
  });

  it("renders negative amounts with a leading minus", () => {
    expect(formatINR(-2500000)).toBe("-₹25,000.00");
  });

  it("degrades null/undefined/NaN to an em dash", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
    expect(formatINR(Number.NaN)).toBe("—");
  });
});

describe("rupee/paise conversion", () => {
  it("rupeesToPaise rounds fractional rupees to integer paise", () => {
    expect(rupeesToPaise(3000)).toBe(300000);
    expect(rupeesToPaise(1595.5)).toBe(159550);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
  });

  it("paiseToRupees is the exact inverse", () => {
    expect(paiseToRupees(17500000)).toBe(175000);
    expect(rupeesToPaise(paiseToRupees(12345))).toBe(12345);
  });
});

describe("parseINRToPaise", () => {
  it("accepts plain, grouped, and ₹-prefixed input", () => {
    expect(parseINRToPaise("150000.5")).toBe(15000050);
    expect(parseINRToPaise("1,50,000")).toBe(15000000);
    expect(parseINRToPaise("₹ 50,000")).toBe(5000000);
    expect(parseINRToPaise("₹0")).toBe(0);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseINRToPaise("")).toBeNull();
    expect(parseINRToPaise("abc")).toBeNull();
    expect(parseINRToPaise("1.2.3")).toBeNull();
  });
});
