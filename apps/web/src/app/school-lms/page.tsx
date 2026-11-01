import { redirect } from 'next/navigation';
import { isSchoolLmsReadonlyEnabled } from '@/lib/server/schoolLmsReadonly';
import LmsPageClient from './LmsPageClient';

export default function Page() {
  if (!isSchoolLmsReadonlyEnabled()) redirect('/classroom');
  return <LmsPageClient />;
}
