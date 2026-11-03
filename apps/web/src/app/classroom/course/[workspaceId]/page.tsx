import { NuniApp } from '@/features/nuni/NuniApp';
import { ClassroomDeepLinkFocus } from './ClassroomDeepLinkFocus';

export default function ClassroomPage() {
  return (
    <>
      <ClassroomDeepLinkFocus />
      <NuniApp />
    </>
  );
}
