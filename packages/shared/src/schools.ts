import type { School } from "./index";

/**
 * Multi-school directory (mock).
 * NOTE: `code` is a human-friendly alias and may collide.
 * `id` is the true unique key.
 */
export const mockSchools: School[] = [
  { id: "tw-demo-uni", code: "DEMO", name: "示範大學", themeColor: "#2563eb", domains: ["demo.edu.tw"] },

  // Example collision: same code, different schools.
  { id: "tw-taichung-uni-a", code: "TCU", name: "台中科技大學（示範A）", themeColor: "#16a34a", domains: ["tcu.edu.tw"] },
  { id: "tw-taichung-uni-b", code: "TCU", name: "台中大學（示範B）", themeColor: "#f97316", domains: ["tcu2.edu.tw"] },

  { id: "tw-nchu", code: "NCHU", name: "國立中興大學（示範）", themeColor: "#991b1b", domains: ["nchu.edu.tw"] },
];

function normalizeDomain(domain?: string | null): string {
  return (domain ?? "").trim().toLowerCase();
}

export function getEmailDomain(email?: string | null): string | null {
  if (!email) return null;
  const parts = String(email).toLowerCase().split("@");
  if (parts.length < 2) return null;
  return normalizeDomain(parts.pop() || "");
}

export function findSchoolByDomain(domain?: string | null): School | undefined {
  const d = normalizeDomain(domain);
  if (!d) return undefined;
  return mockSchools.find((s) => (s.domains || []).map(normalizeDomain).includes(d));
}

export function resolveSchoolByEmail(email?: string | null): School | undefined {
  const domain = getEmailDomain(email);
  if (!domain) return undefined;
  return findSchoolByDomain(domain);
}

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
