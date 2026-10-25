'use client';

import { use } from 'react';
import { MessagingShell, PrivateConversationView } from '@/components/messaging/Messaging';

export default function DmChatPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  return (
    <MessagingShell title="訊息">
      {(session) => (
        <PrivateConversationView
          key={`${session.uid}:${session.schoolId}:${conversationId}`}
          session={session}
          conversationId={conversationId}
        />
      )}
    </MessagingShell>
  );
}
