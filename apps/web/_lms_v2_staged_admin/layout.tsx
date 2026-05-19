import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'LMS 管理後台（最小）',
  description: 'profiles.role = admin 限定；使用 Supabase anon key + RLS。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb', color: '#111827' }}>
        {children}
      </body>
    </html>
  );
}
