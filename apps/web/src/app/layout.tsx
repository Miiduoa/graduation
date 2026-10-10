import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { AuthProvider } from '@/components/AuthGuard';
import { ToastProvider } from '@/components/ui';
import { AppearancePreferences } from '@/components/AppearancePreferences';
import { appearanceBootstrap } from '@/lib/appearanceBootstrap';
import { CampusProviders } from '@/components/CampusProviders';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Campus One｜課程與校園生活',
  description: '課程、校園資訊與跨校交流，接續每天的學習與生活',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Campus One',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'zh_TW',
    siteName: 'Campus One',
    title: 'Campus One｜課程與校園生活',
    description: '課程、校園資訊與跨校交流，接續每天的學習與生活',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Campus One',
    description: '課程、待辦與校園資訊',
  },
  icons: {
    icon: [
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180x180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f7f3' },
    { media: '(prefers-color-scheme: dark)', color: '#171f1b' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
        <link rel="apple-touch-icon" href="/icons/icon-180x180.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Campus One" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#f8f7f3" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body>
        <AppearancePreferences />
        <ServiceWorkerRegistration />
        <AuthProvider>
          <ToastProvider position="top-center">
            <CampusProviders>{children}</CampusProviders>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
