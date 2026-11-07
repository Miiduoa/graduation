import React from 'react';
import { createRoot } from 'react-dom/client';
import MapClient from '../../../apps/web/src/app/map/MapClient';
import { buildCampusClassroomMapHref } from '../../../packages/shared/src/campusClassroomLookup';
import '../../../apps/web/src/app/globals.css';

const params = new URLSearchParams(window.location.search);
const school = params.get('schoolId') || 'pu';
const examples = [
  { label: '主顧303', schoolId: 'pu', location: '主顧303' },
  { label: '未知教室 PH303', schoolId: 'pu', location: 'PH303' },
  { label: '同名建築測試', schoolId: 'qa-campus', location: '測試教學101' },
];

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16, maxWidth: 1100, margin: 'auto' }}>
    <p>地圖元件驗證 · 公開地點快照與明確標示的測試候選；底圖為本機空白格線。</p>
    <nav aria-label="測試教室連結" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {examples.map((example) => <a className="btn" key={example.label}
        href={buildCampusClassroomMapHref(example)!.replace('/map?', '/map.html?')}>
        {example.label}
      </a>)}
    </nav>
    <h1>校園地圖</h1>
    <MapClient school={school} schoolName={school === 'pu' ? '靜宜大學' : 'QA 測試校園'}
      query={params.get('query') || undefined} focus={params.get('focus') || undefined} />
  </main>,
);
