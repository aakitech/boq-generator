import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";
import { generateStructure } from "../lib/ai";

const SHOPFIT_SCOPE = `
PROJECT: Commercial restaurant interior remodel

The works are alterations within an existing shopping-centre tenant unit. Retain the
existing building structure. Remove selected internal partitions, ceilings, floor
finishes, counters, sanitary fittings, electrical fittings, and redundant services.

Construct new lightweight internal partitions and bulkheads. Make good disturbed
surfaces. Install new floor and wall finishes, suspended ceilings, doors, counters,
fixed furniture, sanitary fittings, plumbing connections, lighting, socket outlets,
signage, ventilation, and fire equipment.

Provide a local steel lintel above one widened internal doorway and local support
channels for the menu-board signage. Connect new waste pipework to the existing
drainage point. No foundations, excavation, hardcore, ground-bearing slabs, plinth
walls, structural columns, primary beams, or suspended structural slabs are required.
`;

const runGeminiIntegration = process.env.RUN_GEMINI_INTEGRATION === "1";

describe.skipIf(!runGeminiIntegration)("issue #123 synthetic shopfit integration", () => {
  it(
    "suppresses ground-up scope while retaining explicit local supports",
    async () => {
      loadEnvConfig(process.cwd());

      const structure = await generateStructure(
        SHOPFIT_SCOPE,
        false,
        "trade_based",
        [],
        undefined,
        "shopfit"
      );

      const nonHeaderDescriptions = structure.bills.flatMap((bill) =>
        bill.items
          .filter((item) => !item.is_header)
          .map((item) => item.description)
      );
      const searchable = nonHeaderDescriptions.join("\n");
      const summary = structure.bills.map((bill) => ({
        number: bill.number,
        title: bill.title,
        items: bill.items
          .filter((item) => !item.is_header)
          .map((item) => item.description),
      }));

      console.log("ISSUE_123_SYNTHETIC_RESULT", JSON.stringify(summary, null, 2));

      expect(
        structure.bills.some((bill) => /substructure/i.test(bill.title))
      ).toBe(false);
      expect(
        structure.bills.some((bill) => /^superstructure$/i.test(bill.title))
      ).toBe(false);
      expect(
        structure.bills.some((bill) => /demolition|alteration/i.test(bill.title))
      ).toBe(true);
      expect(searchable).not.toMatch(
        /\b(?:foundation|hardcore|ant-proof|plinth wall|structural column|suspended structural slab)\b/i
      );
      expect(searchable).toMatch(/\blintel\b/i);
      expect(searchable).toMatch(/\b(?:support channel|menu-board|menu board)\b/i);
    },
    180_000
  );
});
