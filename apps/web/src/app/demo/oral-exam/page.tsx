import { redirect } from 'next/navigation';

export default function OralExamDemoPage() {
  redirect('/settings?section=platform');
}
