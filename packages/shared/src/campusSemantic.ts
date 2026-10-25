import {
  CAMPUS_QUICK_DESTINATIONS,
  type CampusQuickDestination,
} from './campusIntent';

export type CampusServicePreview = {
  destination: CampusQuickDestination;
  status: 'available' | 'empty' | 'unavailable' | 'connection-required' | 'open-service';
  source: 'campus-platform' | 'none';
  message: string;
  items: Array<{ title: string; detail: string }>;
};

export type CampusSemanticResult = {
  status: 'understood' | 'clarify' | 'unavailable';
  source: 'model' | 'fallback';
  summary: string;
  destinations: CampusQuickDestination[];
  clarifyingQuestion: string | null;
  previews?: CampusServicePreview[];
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
  const previews: CampusServicePreview[] = [];
  if (row.previews !== undefined) {
    if (!Array.isArray(row.previews) || row.previews.length > 3) return null;
    for (const raw of row.previews) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const preview = raw as Record<string, unknown>;
      if (typeof preview.destination !== 'string' ||
        !destinations.includes(preview.destination as CampusQuickDestination) ||
        !['available', 'empty', 'unavailable', 'connection-required', 'open-service'].includes(String(preview.status)) ||
        !['campus-platform', 'none'].includes(String(preview.source)) ||
        typeof preview.message !== 'string' || preview.message.length > 240 ||
        !Array.isArray(preview.items) || preview.items.length > 4) return null;
      const items: Array<{ title: string; detail: string }> = [];
      for (const rawItem of preview.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return null;
        const item = rawItem as Record<string, unknown>;
        if (typeof item.title !== 'string' || item.title.length > 120 ||
            typeof item.detail !== 'string' || item.detail.length > 180) return null;
        items.push({ title: item.title, detail: item.detail });
      }
      if (!previews.some(p => p.destination === preview.destination)) {
        previews.push({
          destination: preview.destination as CampusQuickDestination,
          status: preview.status as CampusServicePreview['status'],
          source: preview.source as CampusServicePreview['source'],
          message: preview.message,
          items,
        });
      }
    }
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
    previews,
  };
}
