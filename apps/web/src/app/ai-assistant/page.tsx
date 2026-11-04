import LegacyAssistant from './LegacyAssistant';
import { Assistant } from '@/features/nuni/Assistant';
import { nuniEnabled } from '@/lib/nuni/server';
export const dynamic = 'force-dynamic';
export default function AssistantPage() {
  return nuniEnabled() && process.env.CAMPUS_ASSISTANT_ENABLED === 'true' ? <Assistant /> : <LegacyAssistant />;
}
