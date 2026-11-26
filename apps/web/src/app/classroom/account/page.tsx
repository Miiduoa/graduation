import { NuniApp } from '@/features/nuni/NuniApp';
import { googleAccountManagementEnabled } from '@/lib/nuni/googleAccountLink';

export default function ClassroomPage() {
  return <NuniApp googleLinkEnabled={googleAccountManagementEnabled()} />;
}
