import type { Metadata } from 'next';
import { StudentCardPage } from './StudentCardPage';

export const metadata: Metadata = {
  title: '數位學生證 | nuni',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return <StudentCardPage />;
}
