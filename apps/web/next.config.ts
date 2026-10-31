import path from 'node:path';
import type { NextConfig } from 'next';
import { legacyEnabled, legacyHtmlRedirects, legacyRewrites } from './src/lib/legacy-routing';
import { hasVerifiedCatalogSearch, officialLibraryDirectory } from '../../packages/shared/src/officialLibraries';

const firebaseAdminBrowserStub = path.join(__dirname, 'src/lib/nodeNativeStub.ts');

// 本機測試環境（Firebase 模擬器、demo- 專案）才放行 127.0.0.1／localhost，正式建置不會加。
const emulatorTestEnv =
  ['1', 'true'].includes(process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '') &&
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').startsWith('demo-');
const emulatorConnectSrc = emulatorTestEnv
  ? ' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*'
  : '';
const libraryFormOrigins = [...new Set(Object.values(officialLibraryDirectory)
  .filter((library) => library.catalogSearch === 'pu-webpac' || hasVerifiedCatalogSearch(library))
  .map((library) => new URL(library.catalogUrl))
  .filter((url) => url.protocol === 'https:' && !url.username && !url.password)
  .map((url) => url.origin))];

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self' https://accounts.google.com " + libraryFormOrigins.join(' '),
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // api.nuni.tw is the existing school-discovery host used by /auth/account.
  "connect-src 'self' https://api.nuni.tw https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://*.fly.dev https://*.web.app https://*.firebaseapp.com https://huggingface.co https://*.huggingface.co https://*.hf.co wss:" +
    emulatorConnectSrc,
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
  // 4B 只在瀏覽器以 Transformers.js 下載並推論。Next 已預設把
  // @huggingface/transformers 當 server external，不可再列入 transpilePackages，
  // 否則與 serverExternalPackages 衝突，Turbopack 建置會失敗。
  // 原生 Node 綁定不進瀏覽器包；權重也不進伺服器映像。
  serverExternalPackages: ['onnxruntime-node', 'firebase-admin'],
  turbopack: {
    resolveAlias: {
      'onnxruntime-node': { browser: './src/lib/nodeNativeStub.ts' },
      sharp: { browser: './src/lib/nodeNativeStub.ts' },
      'firebase-admin': { browser: './src/lib/nodeNativeStub.ts' },
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-node$': false,
      sharp$: false,
    };
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'firebase-admin': firebaseAdminBrowserStub,
        'firebase-admin$': firebaseAdminBrowserStub,
        'firebase-admin/app': firebaseAdminBrowserStub,
        'firebase-admin/app$': firebaseAdminBrowserStub,
        'firebase-admin/auth': firebaseAdminBrowserStub,
        'firebase-admin/auth$': firebaseAdminBrowserStub,
        'firebase-admin/firestore': firebaseAdminBrowserStub,
        'firebase-admin/firestore$': firebaseAdminBrowserStub,
      };
    }
    return config;
  },
  async redirects() {
    return legacyHtmlRedirects();
  },
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
      ...['/classroom', '/classroom/:path*'].map((source) => ({
        source,
        headers: [{
          key: 'Content-Security-Policy',
          value: contentSecurityPolicy.replace(
            "object-src 'none'",
            "object-src blob:; frame-src 'self' blob:",
          ),
        }],
      })),
      {
        source: '/documents/reader.html',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy.replace(
              "frame-ancestors 'none'",
              "frame-ancestors 'self'",
            ),
          },
        ],
      },
      {
        source: '/merchant',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        ],
      },
      // classroom camera 是建置時讀進映像的；開 ASSIGNMENT_FILE_SUBMIT_ENABLED 必須重建 Web 映像。
      ...(process.env.ASSIGNMENT_FILE_SUBMIT_ENABLED === 'true'
        ? [
            {
              source: '/classroom',
              headers: [
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(self), microphone=(), geolocation=(self)',
                },
              ],
            },
            {
              source: '/classroom/:path*',
              headers: [
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(self), microphone=(), geolocation=(self)',
                },
              ],
            },
          ]
        : []),
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
