import Link from 'next/link';
import LegacyAssistant from './LegacyAssistant';
import { Assistant } from '@/features/nuni/Assistant';
import { nuniEnabled } from '@/lib/nuni/server';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import home from '@/app/home.module.css';

export const dynamic = 'force-dynamic';
export default function AssistantPage() {
  const platformEnabled = nuniEnabled();
  const Entry =
    platformEnabled && process.env.CAMPUS_ASSISTANT_ENABLED === 'true' ? Assistant : LegacyAssistant;
  return (
    <Entry>
      {platformEnabled && (
        <Link className={home.secondary} href="/food">
          {isWebOnlineOrderingEnabled() ? '點餐與取餐' : '查詢訂單與取餐進度'}
        </Link>
      )}
    </Entry>
  );
}
