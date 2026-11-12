import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '課程與作業｜nuni',
  robots: { index: false, follow: false },
};

export default function OralExamLayout({ children }: { children: ReactNode }) {
  return children;
}
