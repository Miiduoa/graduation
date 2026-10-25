import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ClassWorkspace } from '@/features/platform/ClassWorkspace';

export const metadata: Metadata = {
  title: '課班工作台',
  description: '課班簽到、課程內容、邀請與掛靠。',
};

export default async function ClassWorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <Suspense fallback={<p role="status">正在打開課班工作台…</p>}>
      <ClassWorkspace workspaceId={workspaceId} />
    </Suspense>
  );
}
