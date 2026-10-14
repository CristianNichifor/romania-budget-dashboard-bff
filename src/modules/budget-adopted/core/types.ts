import type { Decimal } from "decimal.js";

/**
 * Adopted-budget domain types. Amounts are Decimal (lei) in the core and
 * become strings only at the HTTP boundary — the no-floats rule.
 */

export type FundId = "bs" | "bass" | "bsan" | "bsom";

export const FUND_IDS: FundId[] = ["bs", "bass", "bsan", "bsom"];

export const FUND_NAMES: Record<FundId, string> = {
  bs: "Bugetul de stat",
  bass: "Bugetul asigurărilor sociale de stat",
  bsan: "Fondul național unic de asigurări sociale de sănătate",
  bsom: "Bugetul asigurărilor pentru șomaj",
};

export interface AdoptedFundTotals {
  id: FundId;
  name: string;
  revenue: Decimal;
  expenditure: Decimal;
  deficit: Decimal;
}

export interface AdoptedTotals {
  year: number;
  revenue: Decimal;
  expenditure: Decimal;
  deficit: Decimal;
  funds: AdoptedFundTotals[];
  warnings: string[];
}

/**
 * Scope note shared by the adopted endpoints. Both the adopted law and the
 * execution dataset count intra-budgetary transfers (BS → BASS/BSAN/BSOM)
 * on the expenditure side, so revenue/expenditure levels are "brute" on both
 * sides — only the deficit is directly comparable (transfers cancel out).
 */
export const ADOPTED_SCOPE_NOTE =
  "Buget adoptat (legea bugetului de stat, MFP via data.gov.ro): bugetul de stat și fondurile BASS, BSAN, BSOM. Transferurile intra-bugetare nu sunt eliminate, la fel ca în execuție — deficitul este comparabil, nivelurile venituri/cheltuieli sunt «brute».";

export const COMPARISON_SCOPE_NOTE =
  "Buget adoptat (MFP, data.gov.ro) vs. execuție (transparenta.eu). Ambele includ transferurile intra-bugetare; comparația corectă este deficitul.";

export interface BudgetComparisonPoint {
  year: number;
  adopted: {
    revenue: Decimal;
    expenditure: Decimal;
    deficit: Decimal;
  };
  executed: {
    revenue: Decimal;
    expenditure: Decimal;
    deficit: Decimal;
    deficitPercentGdp: Decimal;
  } | null;
  /**
   * |executed deficit| − |adopted deficit|, in lei. The two sources use
   * opposite sign conventions, so magnitudes are compared; positive means
   * the executed deficit exceeded the adopted one.
   */
  deficitDelta: Decimal | null;
  note: string;
}
