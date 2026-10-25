import {
  CAMPUS_QUICK_DESTINATIONS,
  type CampusQuickDestination,
} from './campusIntent';

export type CampusSemanticResult = {
  status: 'understood' | 'clarify' | 'unavailable';
  source: 'model' | 'fallback';
  summary: string;
  destinations: CampusQuickDestination[];
  clarifyingQuestion: string | null;
};

const allowed = new Set<string>(CAMPUS_QUICK_DESTINATIONS);

export function normalizeCampusSemanticResult(value: unknown): CampusSemanticResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!['understood', 'clarify', 'unavailable'].includes(String(row.status))) return null;
  if (row.source !== 'model' && row.source !== 'fallback') return null;
  if (typeof row.summary !== 'string' || !row.summary.trim() || row.summary.length > 140) return null;
  if (!Array.isArray(row.destinations) || row.destinations.length > 3) return null;
  const destinations: CampusQuickDestination[] = [];
  for (const href of row.destinations) {
    if (typeof href !== 'string' || !allowed.has(href)) return null;
    const typedHref = href as CampusQuickDestination;
    if (!destinations.includes(typedHref)) destinations.push(typedHref);
  }
  const status = row.status as CampusSemanticResult['status'];
  if (status === 'understood' && (!destinations.length || row.source !== 'model')) return null;
  if (status !== 'understood' && destinations.length) return null;
  if (status === 'clarify' && (typeof row.clarifyingQuestion !== 'string' || !row.clarifyingQuestion.trim())) return null;
  if (row.clarifyingQuestion !== null && row.clarifyingQuestion !== undefined &&
      (typeof row.clarifyingQuestion !== 'string' || row.clarifyingQuestion.length > 120)) return null;
  return {
    status,
    source: row.source,
    summary: row.summary.trim(),
    destinations,
    clarifyingQuestion: typeof row.clarifyingQuestion === 'string' ? row.clarifyingQuestion.trim() : null,
  };
}
