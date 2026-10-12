export function normalizeFunctionsBaseUrl(raw?: string | null): string | null {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function resolveFunctionsHttpUrl(options: {
  functionName: string;
  projectId?: string;
  region?: string;
  baseUrl?: string | null;
  emulator?: { host: string; port: number; projectId?: string; region?: string } | null;
}): string {
  if (options.emulator) {
    const projectId = options.emulator.projectId || options.projectId;
    const region = options.emulator.region || options.region || 'asia-east1';
    if (!projectId) {
      throw new Error('Firebase projectId is missing. Check your web environment variables.');
    }
    return `http://${options.emulator.host}:${options.emulator.port}/${projectId}/${region}/${options.functionName}`;
  }

  const base = normalizeFunctionsBaseUrl(options.baseUrl);
  if (base) return `${base}/${options.functionName}`;

  const region = options.region || 'asia-east1';
  if (!options.projectId) {
    throw new Error('Firebase projectId is missing. Check your web environment variables.');
  }
  return `https://${region}-${options.projectId}.cloudfunctions.net/${options.functionName}`;
}
