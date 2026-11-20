import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '平台權限｜nuni',
  description: '管理目前帳號的功能與資料權限。',
  robots: { index: false, follow: false },
};

export default function AccountDemoLayout({ children }: { children: ReactNode }) {
  return children;
}
