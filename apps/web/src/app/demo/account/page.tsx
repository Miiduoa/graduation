import { redirect } from 'next/navigation';

export default function AccountDemoPage() {
  redirect('/settings?section=platform');
}
