import { redirect } from 'next/navigation';
import { isSchoolLmsReadonlyEnabled } from '@/lib/server/schoolLmsReadonly';

export const dynamic = 'force-dynamic';

export default function SchoolLmsLayout({ children }: { children: React.ReactNode }) {
  if (!isSchoolLmsReadonlyEnabled()) redirect('/classroom');
  return children;
}
