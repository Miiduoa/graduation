import type { School } from "./index";

export const mockSchools: School[] = [
  { id: "s-demo", code: "DEMO", name: "示範大學", themeColor: "#2563eb" },
  { id: "s-taichung", code: "TC", name: "台中某大學", themeColor: "#16a34a" }
];

export function resolveSchoolByCode(code?: string | null): School {
  const normalized = (code ?? "").trim().toUpperCase();
  return (
    mockSchools.find((s) => s.code === normalized) ??
    mockSchools[0] // default
  );
}
