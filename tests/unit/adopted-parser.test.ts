import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { FUND_IDS } from "../../src/modules/budget-adopted/core/types";
import {
  buildAdoptedTotals,
  buildBudgetComparison,
  extractRows,
  parseAmount,
  parseFundTotals,
} from "../../src/modules/budget-adopted/core/parser";

/**
 * Fixtures mirror the real MFP anexa 1 exports (Oracle Reports, ISO-8859-2):
 * rows carry DENUMIRE + PROGRAM_YYYY columns with thousands of lei.
 */

const BS_XML_2024 = `<?xml version="1.0" encoding="ISO-8859-2"?>
<MODULE10>
  <LIST_G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <TITLU_RAPORT>BUGETUL DE STAT</TITLU_RAPORT>
      <ANEXA>Anexa nr.1</ANEXA>
      <COD_ORDONATOR>00</COD_ORDONATOR>
      <CAPITOL>0001</CAPITOL>
      <DENUMIRE>VENITURI - TOTAL</DENUMIRE>
      <PROGRAM_2024>308.204.963</PROGRAM_2024>
      <ESTIMARI2025>314.335.523</ESTIMARI2025>
      <ESTIMARI2026>337.103.231</ESTIMARI2026>
    </G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>0002</CAPITOL>
      <DENUMIRE>I.VENITURI CURENTE</DENUMIRE>
      <PROGRAM_2024>237.466.426</PROGRAM_2024>
      <ESTIMARI2025>262.404.237</ESTIMARI2025>
    </G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>9901</CAPITOL>
      <DENUMIRE>DEFICIT</DENUMIRE>
      <PROGRAM_2024>-96.033.089</PROGRAM_2024>
      <ESTIMARI2025>-100.704.202</ESTIMARI2025>
    </G_TITLU_RAPORT>
  </LIST_G_TITLU_RAPORT>
</MODULE10>`;

const BASS_XML_2024 = `<?xml version="1.0" encoding="ISO-8859-2"?>
<MODULE10>
  <LIST_G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>0001</CAPITOL>
      <DENUMIRE>VENITURI - TOTAL</DENUMIRE>
      <PROGRAM_2024>135.225.698</PROGRAM_2024>
      <ESTIMARI2025>141.000.000</ESTIMARI2025>
    </G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>9903</CAPITOL>
      <DENUMIRE>EXCEDENT/DEFICIT</DENUMIRE>
      <PROGRAM_2024>81.345</PROGRAM_2024>
      <ESTIMARI2025>0</ESTIMARI2025>
    </G_TITLU_RAPORT>
  </LIST_G_TITLU_RAPORT>
</MODULE10>`;

const BSAN_XML_2024 = `<?xml version="1.0" encoding="ISO-8859-2"?>
<MODULE10>
  <LIST_G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>0001</CAPITOL>
      <DENUMIRE>VENITURI - TOTAL</DENUMIRE>
      <PROGRAM_2024>62.358.166</PROGRAM_2024>
      <ESTIMARI2025>65.000.000</ESTIMARI2025>
    </G_TITLU_RAPORT>
  </LIST_G_TITLU_RAPORT>
</MODULE10>`;

const BSOM_XML_2024 = `<?xml version="1.0" encoding="ISO-8859-2"?>
<MODULE10>
  <LIST_G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>0001</CAPITOL>
      <DENUMIRE>VENITURI - TOTAL</DENUMIRE>
      <PROGRAM_2024>2.451.382</PROGRAM_2024>
      <ESTIMARI2025>2.500.000</ESTIMARI2025>
    </G_TITLU_RAPORT>
    <G_TITLU_RAPORT>
      <CAPITOL>9904</CAPITOL>
      <DENUMIRE>EXCEDENT/DEFICIT</DENUMIRE>
      <PROGRAM_2024>317.498</PROGRAM_2024>
      <ESTIMARI2025>0</ESTIMARI2025>
    </G_TITLU_RAPORT>
  </LIST_G_TITLU_RAPORT>
</MODULE10>`;

describe("extractRows", () => {
  it("extracts labels with per-year column values", () => {
    const rows = extractRows(BS_XML_2024);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.label).toBe("VENITURI - TOTAL");
    expect(rows[0]?.values.get("PROGRAM_2024")).toBe("308.204.963");
    expect(rows[0]?.values.get("ESTIMARI2026")).toBe("337.103.231");
  });
});

describe("parseAmount", () => {
  it("converts thousands of lei with separators to lei", () => {
    const result = parseAmount("308.204.963");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.eq(new Decimal("308204963000"))).toBe(true);
    }
  });

  it("keeps the sign of deficits", () => {
    const result = parseAmount("-96.033.089");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.eq(new Decimal("-96033089000"))).toBe(true);
    }
  });

  it("rejects empty values", () => {
    expect(parseAmount("").isErr()).toBe(true);
  });
});

describe("parseFundTotals", () => {
  it("parses the state budget: revenue, deficit, derived expenditure", () => {
    const result = parseFundTotals(BS_XML_2024, 2024, "bs");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revenue.toFixed(0)).toBe("308204963000");
      expect(result.value.deficit.toFixed(0)).toBe("-96033089000");
      // expenditure = revenue - deficit
      expect(result.value.expenditure.toFixed(0)).toBe("404238052000");
    }
  });

  it("parses BASS with a positive EXCEDENT/DEFICIT row", () => {
    const result = parseFundTotals(BASS_XML_2024, 2024, "bass");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revenue.toFixed(0)).toBe("135225698000");
      expect(result.value.deficit.toFixed(0)).toBe("81345000");
      expect(result.value.expenditure.toFixed(0)).toBe("135144353000");
    }
  });

  it("treats BSAN as balanced when the deficit row is absent", () => {
    const result = parseFundTotals(BSAN_XML_2024, 2024, "bsan");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.deficit.toFixed(0)).toBe("0");
      expect(result.value.expenditure.eq(result.value.revenue)).toBe(true);
    }
  });

  it("errors when VENITURI - TOTAL is missing", () => {
    const result = parseFundTotals("<MODULE10></MODULE10>", 2024, "bs");
    expect(result.isErr()).toBe(true);
  });

  it("errors when the deficit row is missing for a fund that must have one", () => {
    const result = parseFundTotals(BSAN_XML_2024, 2024, "bass");
    expect(result.isErr()).toBe(true);
  });
});

describe("buildAdoptedTotals", () => {
  it("sums the four funds and requires the state budget", () => {
    const funds = [
      BS_XML_2024,
      BASS_XML_2024,
      BSAN_XML_2024,
      BSOM_XML_2024,
    ].map((xml, index) => parseFundTotals(xml, 2024, FUND_IDS[index]!));
    const totals = buildAdoptedTotals(
      2024,
      funds.map((result) => (result.isOk() ? result.value : null))
    );
    expect(totals.isOk()).toBe(true);
    if (totals.isOk()) {
      expect(totals.value.funds).toHaveLength(4);
      expect(totals.value.revenue.toFixed(0)).toBe("508240209000");
      expect(totals.value.deficit.toFixed(0)).toBe("-95634246000");
      expect(totals.value.warnings).toHaveLength(0);
    }
  });

  it("warns about missing funds but still aggregates", () => {
    const bs = parseFundTotals(BS_XML_2024, 2024, "bs");
    const totals = buildAdoptedTotals(2024, [
      bs.isOk() ? bs.value : null,
      null,
      null,
      null,
    ]);
    expect(totals.isOk()).toBe(true);
    if (totals.isOk()) {
      expect(totals.value.warnings).toHaveLength(3);
      expect(totals.value.revenue.toFixed(0)).toBe("308204963000");
    }
  });

  it("errors without the state budget", () => {
    const totals = buildAdoptedTotals(2024, [null, null, null, null]);
    expect(totals.isErr()).toBe(true);
  });
});

describe("buildBudgetComparison", () => {
  const adopted = (() => {
    const result = buildAdoptedTotals(
      2024,
      [BS_XML_2024, BASS_XML_2024, BSAN_XML_2024, BSOM_XML_2024].map(
        (xml, i) => {
          const parsed = parseFundTotals(xml, 2024, FUND_IDS[i]!);
          return parsed.isOk() ? parsed.value : null;
        }
      )
    );
    if (result.isErr()) {
      throw new Error("fixture error");
    }
    return result.value;
  })();

  const executed = {
    year: 2024,
    revenue: "720000000000",
    expenditure: "872000000000",
    deficit: "152000000000",
    deficitPercentGdp: "8.6",
  };

  it("computes the deficit delta between executed and adopted", () => {
    const comparison = buildBudgetComparison(2024, adopted, executed);
    expect(comparison.executed).not.toBeNull();
    // |152 000 000 000| − |adopted deficit|: positive means the executed
    // deficit came out larger than the law planned.
    expect(comparison.deficitDelta?.toFixed(0)).toBe(
      new Decimal("152000000000").minus(adopted.deficit.abs()).toFixed(0)
    );
  });

  it("compares deficit magnitudes across opposite sign conventions", () => {
    // 2026: the adopted law reports revenue − expenditure (−141,9 mld lei),
    // the execution reports expenditure − revenue (+168,4 mld lei).
    const zero = new Decimal(0);
    const adopted2026 = {
      year: 2026,
      revenue: zero,
      expenditure: zero,
      deficit: new Decimal("-141900000000"),
      funds: [],
      warnings: [],
    };
    const comparison = buildBudgetComparison(2026, adopted2026, {
      year: 2026,
      revenue: "0",
      expenditure: "0",
      deficit: "168400000000",
      deficitPercentGdp: "0",
    });
    expect(comparison.deficitDelta?.toFixed(0)).toBe("26500000000");
  });

  it("gives a negative delta when execution beats the plan", () => {
    const zero = new Decimal(0);
    const comparison = buildBudgetComparison(
      2026,
      {
        year: 2026,
        revenue: zero,
        expenditure: zero,
        deficit: new Decimal("-100"),
        funds: [],
        warnings: [],
      },
      {
        year: 2026,
        revenue: "0",
        expenditure: "0",
        deficit: "80",
        deficitPercentGdp: "0",
      }
    );
    expect(comparison.deficitDelta?.toFixed(0)).toBe("-20");
  });

  it("marks executed as null when no execution summary is available", () => {
    const comparison = buildBudgetComparison(2024, adopted, null);
    expect(comparison.executed).toBeNull();
    expect(comparison.deficitDelta).toBeNull();
  });

  it("carries the scope note", () => {
    const comparison = buildBudgetComparison(2024, adopted, executed);
    expect(comparison.note.length).toBeGreaterThan(0);
  });
});
