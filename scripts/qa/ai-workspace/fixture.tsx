import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from '@/components/AppHeader';
import { AssistantWorkspaceProvider } from '@/components/AssistantWorkspaceProvider';
import { AssistantEnabledProvider } from '@/components/AssistantEnabledProvider';
import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { TodayAssistantDisclosure, type TodayAssistantHandle } from '@/components/TodayCampusEntry';
import { StudentToday } from '@/components/today/StudentToday';
import home from '@/app/home.module.css';
import '@/app/globals.css';
import Link, {
  fixtureOptions,
  selectCampus,
  setChecking,
  setGuest,
  switchAccount,
  useFixture,
} from './boundaries';

document.documentElement.dataset.theme = fixtureOptions.get('theme') === 'dark' ? 'dark' : 'light';
if (fixtureOptions.get('appMotion') === 'reduce')
  document.documentElement.dataset.reducedMotion = 'true';
if (fixtureOptions.get('text') === '200') document.documentElement.style.fontSize = '200%';
const now = new Date('2026-11-24T08:30:00+08:00');

function ProductPages() {
  const current = useFixture();
  const assistant = useRef<TodayAssistantHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const campusSearch = '?' + current.search;
  const homeRoute = current.pathname === '/';
  return (
    <>
      <AppHeader
        onOpenAssistant={homeRoute ? () => assistant.current?.openAssistant() : undefined}
        assistantExpanded={expanded}
      />
      <main className={home.main} id="page-content">
        {homeRoute ? (
          <StudentToday
            now={now}
            updatedAt={now}
            unsigned={current.guest}
            skeleton={false}
            scopeKey={`${current.owner}:${current.schoolId}`}
            timetableSchoolId={current.schoolId}
            campusSearch={current.search}
            timetableStatus="ready"
            todosError=""
            lmsUnconnected={false}
            classes={[
              {
                id: 'qa-class',
                title: '合成資料庫課程',
                location: '合成教室 301',
                startAt: now.getTime() + 30 * 60_000,
                endAt: now.getTime() + 90 * 60_000,
              },
            ]}
            todos={
              current.guest
                ? []
                : [
                    {
                      id: 'qa-work',
                      title: '合成課務待辦',
                      courseName: '合成資料庫課程',
                      courseId: 'qa-course',
                      dueAt: now.getTime() + 6 * 60 * 60_000,
                      href: '/classroom/course/qa-course' + campusSearch,
                    },
                  ]
            }
            onRetryTimetable={() => {}}
            onRetryTodos={() => {}}
            importHref={'/import?kind=timetable&' + current.search}
            weekHref={'/timetable' + campusSearch}
            timetableHref={'/timetable' + campusSearch}
            assistant={<TodayAssistantDisclosure ref={assistant} onOpenChange={setExpanded} />}
          />
        ) : (
          <section className="fixture-destination" aria-label="合成目的地頁面">
            <p className="fixture-note">
              此區只代表導覽目的地；工作區、頂部導覽與對話仍為真正產品元件。
            </p>
            <h1>
              {current.pathname.startsWith('/classroom')
                ? '課程與作業'
                : current.pathname === '/map'
                  ? '校園地圖'
                  : '校園服務'}
            </h1>
            <p data-testid="fixture-route">{current.pathname}</p>
            <nav aria-label="合成頁面導覽">
              <Link href={'/classroom/course/qa-course' + campusSearch}>前往課程與作業</Link>
              <Link href={'/map' + campusSearch}>前往校園地圖</Link>
              <Link href={'/' + campusSearch}>回到今天</Link>
            </nav>
          </section>
        )}
        <section className="fixture-controls" aria-label="隔離驗收控制">
          <p>
            AI 工作區驗收：真正產品元件與樣式，僅使用合成身分、校園、資料及回答，未連線正式服務。
          </p>
          <div className="fixture-buttons">
            <button type="button" onClick={switchAccount}>
              QA：切換帳號
            </button>
            <button
              type="button"
              onClick={() => selectCampus(current.schoolId === 'pu' ? 'ntu' : 'pu')}
            >
              QA：切換校園
            </button>
            <button type="button" onClick={() => setGuest(!current.guest)}>
              QA：{current.guest ? '登入合成帳號' : '切為訪客'}
            </button>
            <button type="button" onClick={() => setChecking(!current.checking)}>
              QA：{current.checking ? '完成身分查核' : '開始身分查核'}
            </button>
          </div>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <SchoolLmsReadonlyProvider enabled>
    <AssistantEnabledProvider enabled>
      <div className={home.page + ' ' + home.todayPage} data-product="ai-workspace">
        <AssistantWorkspaceProvider>
          <ProductPages />
        </AssistantWorkspaceProvider>
      </div>
    </AssistantEnabledProvider>
  </SchoolLmsReadonlyProvider>,
);
