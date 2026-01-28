import type { School } from "./index";

/**
 * Multi-school directory (mock).
 * NOTE: `code` is a human-friendly alias and may collide.
 * `id` is the true unique key.
 */
export const mockSchools: School[] = [
  { id: "tw-demo-uni", code: "DEMO", name: "示範大學", themeColor: "#2563eb" },

  // Example collision: same code, different schools.
  { id: "tw-taichung-uni-a", code: "TCU", name: "台中科技大學（示範A）", themeColor: "#16a34a" },
  { id: "tw-taichung-uni-b", code: "TCU", name: "台中大學（示範B）", themeColor: "#f97316" },

  { id: "tw-nchu", code: "NCHU", name: "國立中興大學（示範）", themeColor: "#991b1b" },
];

export function normalizeSchoolCode(code?: string | null): string {
  return (code ?? "").trim().toUpperCase();
}

export function findSchoolsByCode(code?: string | null): School[] {
  const c = normalizeSchoolCode(code);
  if (!c) return [];
  return mockSchools.filter((s) => s.code === c);
}

export function findSchoolById(id?: string | null): School | undefined {
  const v = (id ?? "").trim();
  if (!v) return undefined;
  return mockSchools.find((s) => s.id === v);
}

/**
 * Resolve selection priority:
 * 1) schoolId (unique)
 * 2) school code (if unique)
 * 3) fallback default
 */
export function resolveSchool(params?: { schoolId?: string | null; school?: string | null }): School {
  const byId = findSchoolById(params?.schoolId);
  if (byId) return byId;

  const matches = findSchoolsByCode(params?.school);
  if (matches.length === 1) return matches[0];

  return mockSchools[0];
}
