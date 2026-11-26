import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PersonalCalendar } from '../../../apps/web/src/components/calendar/PersonalCalendar';
import home from '../../../apps/web/src/app/home.module.css';
import '../../../apps/web/src/app/globals.css';
import {
  fixtureOptions,
  prepareSaveFailure,
  seedCalendar,
  switchAccount,
  switchSchool,
  useSelectedSchool,
} from './boundaries';

document.documentElement.dataset.theme = fixtureOptions.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.reducedMotion =
  fixtureOptions.get('motion') === 'reduce' ? 'true' : 'false';
if (fixtureOptions.get('text') === '200') document.documentElement.style.fontSize = '200%';
seedCalendar();

function Fixture() {
  const school = useSelectedSchool();
  const [failurePrepared, setFailurePrepared] = useState(false);
  return (
    <div className={home.page}>
      <main id="page-content" className={home.main} tabIndex={-1}>
        <div className={home.heading}>
          <div>
            <p className={home.eyebrow}>{school.selectedSchool?.name}</p>
            <h1>個人行事曆</h1>
            <p className={home.intro}>選一天，整理自己的安排。</p>
          </div>
        </div>
        <PersonalCalendar />
        <section className="fixture-controls" aria-label="行事曆驗收控制">
          <h2>合成資料驗收</h2>
          <p>
            這裡使用真實行事曆元件與裝置儲存流程，帳號、校園、課程來源為明示合成資料。沒有正式帳號登入或對外寫入；頁首為隔離驗收外框。
          </p>
          <div className="fixture-buttons">
            <button type="button" className="btn" onClick={switchSchool}>
              切換合成校園
            </button>
            <button type="button" className="btn" onClick={switchAccount}>
              切換合成帳號
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                prepareSaveFailure();
                setFailurePrepared(true);
              }}
            >
              下次儲存模擬失敗
            </button>
          </div>
          {failurePrepared && <p>已準備一次合成儲存錯誤；只影響下一次行程儲存。</p>}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
