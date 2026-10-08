'use client';

import { MessagingShell, PrivateNotifications } from '@/components/messaging/Messaging';

export default function MessagesPage() {
  return (
    <MessagingShell title="通知" section="notifications">
      {(session) => <PrivateNotifications session={session} />}
    </MessagingShell>
  );
}
