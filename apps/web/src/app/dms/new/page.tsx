'use client';

import { use } from 'react';
import { MessagingShell } from '@/components/messaging/Messaging';
import { NewPrivateConversation } from '@/components/messaging/NewPrivateConversation';

export default function NewDmPage({ searchParams }: {
  searchParams: Promise<{ peer?: string | string[] }>;
}) {
  const params = use(searchParams);
  const peerUid = typeof params.peer === 'string' ? params.peer : undefined;
  const returnUrl = peerUid ? `/dms/new?peer=${encodeURIComponent(peerUid)}` : '/dms/new';
  return (
    <MessagingShell
      title="新增訊息"
      subtitle="尋找同校同學，傳送文字或照片開啟對話。"
      returnUrl={returnUrl}
    >
      {(session) => <NewPrivateConversation session={session} peerUid={peerUid} />}
    </MessagingShell>
  );
}
