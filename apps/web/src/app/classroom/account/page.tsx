import { NuniApp } from '@/features/nuni/NuniApp';
import { googleAccountLinkEnabled } from '@/lib/nuni/googleAccountLink';

export default function ClassroomPage() {
  return <NuniApp googleLinkEnabled={googleAccountLinkEnabled()} />;
}
