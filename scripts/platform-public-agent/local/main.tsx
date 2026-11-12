import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  PublicNavigationTask,
  type PublicTaskPort,
} from '../../../apps/web/src/app/map/PublicNavigationTask';
import '../../../apps/web/src/app/globals.css';

function App() {
  const [account, setAccount] = useState('a'),
    [school, setSchool] = useState('pu');
  const port: PublicTaskPort = {
    scope: `synthetic-${account}`,
    schoolId: school,
    schoolName: school === 'pu' ? '靜宜大學' : '另一校園（無目錄）',
    localPreview: true,
    async call(action, body, signal) {
      const response = await fetch(`/api/platform-public-agent/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-public-task': '1',
          'x-session-context': `synthetic-${account}`,
          'x-local-fixture-account': account,
        },
        body: JSON.stringify(body),
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code);
      return result;
    },
  };
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <p>nuni · 校園地圖</p>
      <h1>公開校園導航</h1>
      <p>不需連結校務帳號。本機測試不建立正式帳號、不連接資料庫或模型。</p>
      <div
        className="card"
        style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}
      >
        <label>
          合成帳號{' '}
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="a">測試帳號 A</option>
            <option value="b">測試帳號 B</option>
            <option value="signed-out">未登入</option>
          </select>
        </label>
        <label>
          公開目錄{' '}
          <select value={school} onChange={(event) => setSchool(event.target.value)}>
            <option value="pu">靜宜大學</option>
            <option value="other">另一校園</option>
          </select>
        </label>
      </div>
      <PublicNavigationTask port={port} />
      <p>
        資料：專案隨附 OpenStreetMap
        地點快照（2026-10-19），不是即時通行資訊。範例：從主顧樓到蓋夏圖書館。
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
