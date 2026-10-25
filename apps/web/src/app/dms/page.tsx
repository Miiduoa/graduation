'use client';

import { MessagingShell, PrivateConversationList } from '@/components/messaging/Messaging';

export default function DmsListPage() {
  return (
    <MessagingShell title="訊息">
      {(session) => <PrivateConversationList session={session} />}
    </MessagingShell>
  );
}
