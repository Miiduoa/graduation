'use client';

import { SiteShell } from '@/components/SiteShell';
import { PersonalImportCenter } from '@/components/imports/PersonalImportCenter';

export default function ImportPage() {
  return (
    <SiteShell title="匯入我的資料">
      <PersonalImportCenter />
    </SiteShell>
  );
}
