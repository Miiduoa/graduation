import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/AuthGuard";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "校園助手 - 智慧校園一站式平台",
  description: "靜宜大學校園資訊平台，整合公告、活動、地圖、餐廳、課表與成績查詢",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "校園助手",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: "校園助手",
    title: "校園助手 - 智慧校園一站式平台",
    description: "靜宜大學校園資訊平台，整合公告、活動、地圖、餐廳、課表與成績查詢",
  },
  twitter: {
    card: "summary_large_image",
    title: "校園助手",
    description: "智慧校園一站式平台",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF3FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1420" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

function PWARegister() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js')
                .then(function(registration) {
                  console.log('[PWA] SW registered:', registration.scope);
                })
                .catch(function(error) {
                  console.log('[PWA] SW registration failed:', error);
                });
            });
          }
        `,
      }}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-180x180.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="校園助手" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#EEF3FB" />
        <meta name="msapplication-tap-highlight" content="no" />
        <PWARegister />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider position="top-center">{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
