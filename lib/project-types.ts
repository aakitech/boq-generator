export const PROJECT_TYPES = [
  { value: "building", label: "Building" },
  { value: "interior_remodel", label: "Interior remodel" },
  { value: "renovation", label: "Renovation" },
  { value: "shopfit", label: "Shopfit" },
  { value: "civil", label: "Civil works" },
  { value: "water_sanitation", label: "Water & sanitation" },
  { value: "road", label: "Road & pavement" },
  { value: "mep", label: "MEP" },
  { value: "mixed", label: "Mixed" },
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number]["value"];

const INTERIOR_PROJECT_TYPES = new Set<ProjectType>([
  "interior_remodel",
  "renovation",
  "shopfit",
]);

export function isInteriorProjectType(projectType?: string): boolean {
  return projectType ? INTERIOR_PROJECT_TYPES.has(projectType as ProjectType) : false;
}

export function formatProjectType(projectType: string): string {
  return projectType.replaceAll("_", " ");
}
