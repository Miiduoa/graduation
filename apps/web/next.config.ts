import type { NextConfig } from 'next';
import { legacyEnabled, legacyRewrites } from './src/lib/legacy-routing';

// 本機測試環境（Firebase 模擬器、demo- 專案）才放行 127.0.0.1／localhost，正式建置不會加。
const emulatorTestEnv =
  ['1', 'true'].includes(process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '') &&
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').startsWith('demo-');
const emulatorConnectSrc = emulatorTestEnv
  ? ' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*'
  : '';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self' https://accounts.google.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://*.fly.dev https://*.web.app https://*.firebaseapp.com https://cdn.jsdelivr.net https://*.jsdelivr.net wss:" + emulatorConnectSrc,
].join('; ');

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  agentRules: false,
  async rewrites() {
    return legacyRewrites(legacyEnabled());
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          ...securityHeaders,
        ],
      },
      {
        source: '/sso-callback',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/sso/acs',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
