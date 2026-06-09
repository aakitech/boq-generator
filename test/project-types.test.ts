import { describe, expect, it } from "vitest";
import { buildStructureSystemInstruction } from "../lib/ai";
import {
  formatProjectType,
  isInteriorProjectType,
  PROJECT_TYPES,
} from "../lib/project-types";

describe("project types", () => {
  it("exposes the interior project options", () => {
    const values = PROJECT_TYPES.map((projectType) => projectType.value);

    expect(values).toContain("interior_remodel");
    expect(values).toContain("renovation");
    expect(values).toContain("shopfit");
  });

  it("identifies and formats interior project types", () => {
    expect(isInteriorProjectType("interior_remodel")).toBe(true);
    expect(isInteriorProjectType("shopfit")).toBe(true);
    expect(isInteriorProjectType("building")).toBe(false);
    expect(formatProjectType("interior_remodel")).toBe("interior remodel");
  });
});

describe("structure prompt project context", () => {
  it("adds interior scope restrictions for a shopfit", () => {
    const prompt = buildStructureSystemInstruction(
      false,
      "trade_based",
      [],
      "shopfit"
    );

    expect(prompt).toContain("PROJECT TYPE: shopfit");
    expect(prompt).toContain("Bill 2 - DEMOLITION AND ALTERATIONS");
    expect(prompt).toContain("Do not create a SUBSTRUCTURE bill");
    expect(prompt).toContain("Do not title a bill SUBSTRUCTURE or SUPERSTRUCTURE");
    expect(prompt).toContain("only when the source documents explicitly require");
    expect(prompt).toContain("Keep explicitly documented local supports");
  });

  it("keeps the interior restrictions in recovery mode", () => {
    const prompt = buildStructureSystemInstruction(
      true,
      "trade_based",
      [],
      "interior_remodel"
    );

    expect(prompt).toContain("recovering a failed BOQ structure extraction");
    expect(prompt).toContain("Do not create a SUBSTRUCTURE bill");
  });

  it("does not change the ordinary building prompt", () => {
    const prompt = buildStructureSystemInstruction(
      false,
      "trade_based",
      [],
      "building"
    );

    expect(prompt).toContain("Bill 2");
    expect(prompt).toContain("SUBSTRUCTURE");
    expect(prompt).not.toContain("INTERIOR REMODEL / RENOVATION / SHOPFIT SCOPE");
  });
});
