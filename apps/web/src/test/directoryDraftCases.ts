export const directoryDraftCases = [
  { name: 'school only, platform fails', saved: 'school', school: 'a', platform: 'failed', restored: true },
  { name: 'platform only, school fails', saved: 'platform', school: 'failed', platform: 'a', restored: true },
  { name: 'both accounts match', saved: 'both', school: 'a', platform: 'a', restored: true },
  { name: 'both sources fail', saved: 'both', school: 'failed', platform: 'failed', restored: false, retained: true },
  { name: 'school changes, platform fails', saved: 'both', school: 'b', platform: 'failed', restored: false },
  { name: 'platform changes, school fails', saved: 'both', school: 'failed', platform: 'b', restored: false },
  { name: 'school matches, platform changes', saved: 'both', school: 'a', platform: 'b', restored: false },
  { name: 'accounts match, campus changes', saved: 'both', school: 'a', platform: 'a', campus: 'nthu', restored: false },
] as const;
