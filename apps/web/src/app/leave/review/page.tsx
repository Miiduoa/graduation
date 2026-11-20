import { isLeaveWebApiServerEnabled } from '@/lib/server/leaveWebApiEnabled';
import { LeaveReviewPageClient } from './LeaveReviewPageClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LeaveReviewPage() {
  return <LeaveReviewPageClient leaveApiEnabled={isLeaveWebApiServerEnabled()} />;
}
