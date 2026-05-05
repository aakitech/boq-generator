import path from "path";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

const PROJECT_TYPE_MAP: Record<string, string> = {
  building: "building.xlsx",
  civil: "civil.xlsx",
  water_sanitation: "water_sanitation.xlsx",
  walkway_drainage: "walkway_drainage.xlsx",
};

const DEFAULT_TEMPLATE = "building.xlsx";

export function selectTemplatePath(projectType?: string): string {
  const filename =
    (projectType && PROJECT_TYPE_MAP[projectType]) ?? DEFAULT_TEMPLATE;
  return path.join(TEMPLATES_DIR, filename);
}
