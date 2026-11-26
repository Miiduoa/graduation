import { Suspense } from 'react';
import { SocialWorkspace } from '@/features/social/SocialWorkspace';

export default function SocialPage() {
  return (
    <Suspense fallback={<p role="status">正在載入公開交流…</p>}>
      <SocialWorkspace />
    </Suspense>
  );
}
