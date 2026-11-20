/** Legacy on-campus AR path nodes are modeled for Providence University only. */
export function canUseProvidencePathNetwork(schoolId?: string | null): boolean {
  return schoolId === 'pu';
}
