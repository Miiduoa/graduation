import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '口試示範工作區｜nuni',
  description: '2026-11-12 研究所口試用的本機示範資料，不含真實校園帳號。',
  robots: { index: false, follow: false },
};

export default function OralExamLayout({ children }: { children: ReactNode }) {
  return children;
}
