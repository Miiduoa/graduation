import type { Metadata } from 'next';
import { StudentCardCheck } from './StudentCardCheck';

export const metadata: Metadata = {
  title: '學生證核對 | nuni',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return <StudentCardCheck />;
}
