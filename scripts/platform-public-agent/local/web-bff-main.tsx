import React from 'react';
import { createRoot } from 'react-dom/client';
import { NuniSessionProvider } from '../../../apps/web/src/features/nuni/Session';
import { PublicNavigationTask } from '../../../apps/web/src/app/map/PublicNavigationTask';
import { usePublicNavigationPort } from '../../../apps/web/src/app/map/usePublicNavigationPort';
import '../../../apps/web/src/app/globals.css';
function Navigation() {
  const { port, needsSignIn } = usePublicNavigationPort('pu', '靜宜大學');
  return (
    <main style={{ maxWidth: 760, margin: 'auto', padding: 24 }}>
      <h1>公開校園導航</h1>
      <p>本機合成 session 與隔離交易測試，未使用雲端模型。</p>
      {needsSignIn && <p>請先登入</p>}
      {port && <PublicNavigationTask port={port} />}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <NuniSessionProvider>
    <Navigation />
  </NuniSessionProvider>,
);
