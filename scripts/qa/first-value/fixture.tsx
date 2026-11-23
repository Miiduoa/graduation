import { useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentToday } from '../../../apps/web/src/components/today/StudentToday';
import home from '../../../apps/web/src/app/home.module.css';
import '../../../apps/web/src/app/globals.css';
import {
  fixtureOptions, refreshSameScope, retryTimetable, retryWork, selectCampus,
  selectScenario, switchAccount, useFixture, type Scenario,
} from './boundaries';

document.documentElement.dataset.theme = fixtureOptions.get('theme') === 'dark' ? 'dark' : 'light';
if (fixtureOptions.get('motion') === 'reduce') document.documentElement.dataset.reducedMotion = 'true';
if (fixtureOptions.get('text') === '200') document.documentElement.style.fontSize = '200%';
const now = new Date('2026-11-22T09:00:00+08:00');
type Props = ComponentProps<typeof StudentToday>;

// This injected slot measures StudentToday's child continuity only. It does
// not substitute the assistant implementation or claim real conversation QA.
function SyntheticDraftSlot() {
  const [text, setText] = useState('');
  return (
    <section className="fixture-draft" aria-label="合成助理插槽">
      <label htmlFor="fixture-assistant-draft">合成助理草稿（僅驗證同範圍更新）</label>
      <textarea id="fixture-assistant-draft" value={text} onChange={(event) => setText(event.target.value)} />
    </section>
  );
}

const controls: Array<[Scenario, string]> = [
  ['setup', '已登入未設定'], ['setup-refresh', '已確認空課程背景更新'],
  ['coursework', '有待繳作業'], ['weekend', '週末已有課表'],
  ['loading', '課表讀取中'], ['error', '課表讀取失敗'], ['partial', '作業讀取中'],
  ['work-error', '作業讀取失敗'], ['work-error-with-known', '部分作業讀取失敗'],
  ['work-refresh-with-known', '已有作業背景更新'], ['skeleton', '帳號載入中'], ['class', '有下一堂課'],
  ['existing-course', '已有 nuni 課程'], ['needs-campus', '未選校園'], ['guest', '訪客'],
  ['different-campus', '課表與瀏覽校園不同'],
];

function Fixture() {
  const current = useFixture();
  const { scenario, schoolId, owner } = current;
  const campus = schoolId || 'all';
  const timetableCampus = scenario === 'different-campus' ? 'nchu' : campus;
  const timetableHref = `/timetable?campus=${timetableCampus}`;
  const importHref = `/import?kind=timetable&campus=${timetableCampus}`;
  const classes: Props['classes'] = scenario === 'class' ? [{
    id: `class-${owner}-${campus}`, title: `${owner} 的 ${campus} 合成課程`, location: '合成教室 301',
    startAt: now.getTime() + 15 * 60_000, endAt: now.getTime() + 75 * 60_000,
  }] : [];
  const todos: Props['todos'] = ['coursework', 'work-error-with-known', 'work-refresh-with-known'].includes(scenario) ? [{
    id: `work-${owner}-${campus}`, title: `${owner} 的 ${campus} 合成作業`, courseName: '合成資料庫課程',
    courseId: 'qa-course', dueAt: now.getTime() + 2 * 60 * 60_000,
    href: `/classroom/course/qa-${owner}-${campus}#assignment-qa-work`,
  }] : [];
  const timetableStatus: Props['timetableStatus'] =
    scenario === 'needs-campus' ? 'unsigned-scope' : scenario === 'loading' ? 'loading'
    : scenario === 'error' ? 'error' : scenario === 'weekend' || scenario === 'class' ? 'ready' : 'empty';
  return (
    <div className={home.page + ' ' + home.todayPage}>
      <main className={home.main}>
        <div data-product="first-value">
          <StudentToday
            now={now} updatedAt={now} scopeKey={`${owner}:${timetableCampus}`} timetableSchoolId={timetableCampus === 'all' ? null : timetableCampus}
            campusSearch={current.search} unsigned={scenario === 'guest'} skeleton={scenario === 'skeleton'}
            refreshing={['partial', 'setup-refresh', 'work-refresh-with-known'].includes(scenario)}
            courseDataResolved={scenario !== 'partial' && scenario !== 'skeleton'}
            classes={classes} todos={todos} timetableStatus={timetableStatus}
            todosError={['work-error', 'work-error-with-known'].includes(scenario) ? '合成作業來源暫時讀不到，請重試。' : ''}
            lmsUnconnected={['setup', 'setup-refresh', 'needs-campus', 'guest'].includes(scenario)}
            onRetryTimetable={retryTimetable} onRetryTodos={retryWork}
            importHref={importHref} weekHref={timetableHref} timetableHref={timetableHref}
            assistant={<SyntheticDraftSlot />}
          />
        </div>
        <section className="fixture-controls" aria-label="首次價值驗收控制">
          <p>真實首頁元件與 CSS。帳號、校園、課程、通知為合成資料，沒有正式 API 呼叫。</p>
          <p>助理插槽僅量測同範圍更新不卸載子元件；帳號邊界由正式 HomePage 管理。</p>
          <output aria-label="合成資料範圍">{owner} · {campus} · {scenario} · {current.revision}</output>
          <div className="fixture-buttons">
            {controls.map(([value, label]) => <button key={value} type="button" onClick={() => selectScenario(value)}>{label}</button>)}
            <button type="button" onClick={() => selectCampus('nchu')}>切換中興</button>
            <button type="button" onClick={() => selectCampus('ntu')}>切換臺大</button>
            <button type="button" onClick={switchAccount}>切換帳號</button>
            <button type="button" onClick={refreshSameScope}>刷新相同帳號</button>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
