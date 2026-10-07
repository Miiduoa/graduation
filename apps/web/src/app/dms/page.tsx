'use client';

import { MessagingShell, PrivateConversationList } from '@/components/messaging/Messaging';

export default function DmsListPage() {
  return (
    <MessagingShell title="私人對話">
      {(session) => <PrivateConversationList session={session} />}
    </MessagingShell>
  );
}
