import Link from 'next/link';
import LegacyAssistant from './LegacyAssistant';
import { AssistantEntry } from './AssistantEntry';
import { AssistantWorkspacePage } from '@/components/AssistantWorkspacePage';
import { Suspense } from 'react';
import { nuniEnabled } from '@/lib/nuni/server';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import home from '@/app/home.module.css';

export const dynamic = 'force-dynamic';
export default function AssistantPage() {
  const platformEnabled = nuniEnabled();
  return <Suspense fallback={<p role="status">正在開啟助理…</p>}><AssistantWorkspacePage>{platformEnabled ? (
    <AssistantEntry cloudEnabled={process.env.CAMPUS_ASSISTANT_ENABLED === 'true'}>
        <Link className={home.secondary} href="/food">
          {isWebOnlineOrderingEnabled() ? '點餐與取餐' : '查詢訂單與取餐進度'}
        </Link>
    </AssistantEntry>
  ) : <LegacyAssistant />}</AssistantWorkspacePage></Suspense>;
}
