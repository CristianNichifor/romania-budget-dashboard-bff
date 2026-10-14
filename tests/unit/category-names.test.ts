import { describe, expect, it } from "vitest";
import { buildDestinations } from "../../src/modules/budget/core/analytics-mapping";
import { normalizeCategoryName } from "../../src/modules/budget/core/category-names";

describe("normalizeCategoryName", () => {
  it.each([
    [
      "Pensii si ajutoare pentru batrinete",
      "Pensii și ajutoare pentru bătrânețe",
    ],
    ["Aparare nationala", "Apărare națională"],
    [
      "Asistenta sociala  in  caz de invaliditate",
      "Asistență socială în caz de invaliditate",
    ],
    ["Salarii de baza", "Salarii de bază"],
  ])("restores diacritics in %s", (raw, expected) => {
    expect(normalizeCategoryName(raw)).toBe(expected);
  });

  it("passes unknown names through unchanged", () => {
    expect(normalizeCategoryName("Spitale generale")).toBe("Spitale generale");
    expect(normalizeCategoryName("Ceva nou")).toBe("Ceva nou");
  });

  it("uses comma-below ș and ț only", () => {
    expect(normalizeCategoryName("Aparare nationala")).not.toMatch(/[şţŞŢ]/);
  });
});

describe("buildDestinations names", () => {
  it("normalises functional and economic names", () => {
    const [destination] = buildDestinations([
      {
        functional_code: "68.03.00",
        functional_name: "Pensii si ajutoare pentru batrinete",
        economic_code: "57.01",
        economic_name: "Ajutoare sociale in numerar",
        amount: 10,
        count: 1,
      },
    ]);
    expect(destination?.name).toBe("Pensii și ajutoare pentru bătrânețe");
    expect(destination?.subDestinations?.[0]?.name).toBe(
      "Ajutoare sociale în numerar"
    );
  });
});
