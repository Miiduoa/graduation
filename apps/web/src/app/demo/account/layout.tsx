import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '我的展示工作區｜nuni',
  description: '管理本人帳號的展示資料、學生證與校園服務流程。',
  robots: { index: false, follow: false },
};

export default function AccountDemoLayout({ children }: { children: ReactNode }) {
  return children;
}
