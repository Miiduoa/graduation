import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CampusPersonalization } from '@/components/today/CampusPersonalization';
import { useCampusPersonalization } from '@/lib/useCampusPersonalization';
import { campusPreferencesStorageKey } from '@/lib/campusPreferences';
import { buildCampusRecommendations } from '@campus/shared/src/campusPersonalization';
import '@/app/globals.css';

document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get('theme') || 'light';

function Fixture() {
  const [owner, setOwner] = useState('platform:fixture-alice');
  const [now, setNow] = useState(new Date('2026-11-13T12:00:00+08:00'));
  const scope = { owner, schoolId: 'pu' };
  const model = useCampusPersonalization(scope);
  return (
    <>
      <div className="fixture">
        <p>首頁安排元件驗收 · 測試帳號與日期，未連線正式服務</p>
        <button
          onClick={() =>
            setOwner((value) =>
              value.endsWith('alice') ? 'platform:fixture-bob' : 'platform:fixture-alice',
            )
          }
        >
          測試切換帳號
        </button>
        <button onClick={() => setNow(new Date('2026-11-21T00:00:00+08:00'))}>
          測試準備期間到期
        </button>
      </div>
      {model.preferences ? (
        <CampusPersonalization
          key={campusPreferencesStorageKey(scope)}
          preferences={model.preferences}
          recommendations={buildCampusRecommendations({
            preferences: model.preferences,
            now,
            events: [],
            schoolId: 'pu',
          })}
          now={now}
          onSave={model.save}
          storageError={model.storageError}
          schoolName="靜宜大學"
        />
      ) : (
        <p role="status">正在讀取偏好</p>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
