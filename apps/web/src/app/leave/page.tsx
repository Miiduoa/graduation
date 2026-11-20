import { isLeaveWebApiServerEnabled } from '@/lib/server/leaveWebApiEnabled';
import { LeavePageClient } from './LeavePageClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LeavePage() {
  return <LeavePageClient leaveApiEnabled={isLeaveWebApiServerEnabled()} />;
}
