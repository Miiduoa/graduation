import { createRoot } from 'react-dom/client';
import { AppHeader } from '../../../apps/web/src/components/AppHeader';
import { AcademicNavigation } from '../../../apps/web/src/components/academic/AcademicNavigation';
import { StudentToday } from '../../../apps/web/src/components/today/StudentToday';
import { Button } from '../../../apps/web/src/components/ui/Button';
import { ToastProvider, useToast } from '../../../apps/web/src/components/ui/Toast';
import { SchoolLmsReadonlyProvider } from '../../../apps/web/src/components/SchoolLmsReadonlyProvider';
import { navigate, usePathname } from './boundaries';
import home from '../../../apps/web/src/app/home.module.css';
import '../../../apps/web/src/app/globals.css';

const now = new Date('2026-11-18T09:00:00+08:00');
const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
if (query.get('motion') === 'reduce') document.documentElement.dataset.reducedMotion = 'true';
if (query.get('text') === '200') document.documentElement.style.fontSize = '200%';
const guest = query.get('role') === 'guest';

function Controls() {
  const toast = useToast();
  return (
    <section className="fixture-controls" aria-label="介面驗收控制">
      <p>介面驗收：固定合成帳號、學校與課程資料，沒有正式 API 寫入。</p>
      <div className="fixture-buttons">
        <Button
          type="button"
          variant="primary"
          onClick={() =>
            toast.showToast({
              type: 'success',
              title: '已儲存安排',
              message: '資料結構課程的準備時間已更新。你可以繼續查看課表與作業。',
              duration: 1500,
            })
          }
        >
          顯示完成通知
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/school-lms?schoolId=pu&campus=pu')}
        >
          查看課務分頁
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate('/')}>
          返回今天
        </Button>
        <Button type="button" loading>
          儲存中
        </Button>
        <Button type="button" disabled>
          尚未開放
        </Button>
      </div>
    </section>
  );
}

function Fixture() {
  const pathname = usePathname();
  return (
    <SchoolLmsReadonlyProvider enabled>
      <ToastProvider position="bottom-right">
        <div className={pathname === '/' ? `${home.page} ${home.todayPage}` : home.page}>
          <AppHeader />
          <main className={home.main} id="page-content" tabIndex={-1}>
            {pathname === '/' ? (
              <StudentToday
                now={now}
                updatedAt={now}
                unsigned={guest}
                skeleton={false}
                classes={
                  guest
                    ? []
                    : [
                        {
                          id: 'a',
                          title: '資料結構',
                          location: '管理大樓 M302',
                          courseId: 'fixture-a',
                          startAt: Date.parse('2026-11-18T10:10:00+08:00'),
                          endAt: Date.parse('2026-11-18T12:00:00+08:00'),
                        },
                        {
                          id: 'b',
                          title: '智慧互動設計實務',
                          location: '資訊大樓 I208',
                          courseId: 'fixture-b',
                          startAt: Date.parse('2026-11-18T18:00:00+08:00'),
                          endAt: Date.parse('2026-11-18T20:50:00+08:00'),
                        },
                      ]
                }
                todos={
                  guest
                    ? []
                    : [
                        {
                          id: 'work-a',
                          title: '小組專題進度紀錄',
                          courseName: '系統分析與設計',
                          courseId: 'fixture-c',
                          dueAt: Date.parse('2026-11-18T23:59:00+08:00'),
                          href: '/course/fixture-c#assignment-work-a',
                        },
                        {
                          id: 'work-b',
                          title: '資料處理練習',
                          courseName: '大數據分析',
                          courseId: 'fixture-d',
                          dueAt: Date.parse('2026-11-20T23:59:00+08:00'),
                          href: '/course/fixture-d#assignment-work-b',
                        },
                      ]
                }
                timetableStatus={guest ? 'empty' : 'ready'}
                todosError=""
                lmsUnconnected={false}
                onRetryTimetable={() => {}}
                onRetryTodos={() => {}}
                importHref="/import?kind=timetable&schoolId=pu&campus=pu"
                weekHref="/timetable?schoolId=pu&campus=pu"
                timetableHref="/timetable?schoolId=pu&campus=pu"
                timetableSchoolId="pu"
              />
            ) : (
              <>
                <div className={home.heading}>
                  <h1>課務導覽</h1>
                </div>
                <AcademicNavigation />
                <p className="fixture-copy">
                  這個驗收頁使用實際課務導覽，確認窄畫面、較大字體及鍵盤焦點下，現在的分區仍清楚可見。
                </p>
              </>
            )}
            <Controls />
            {pathname !== '/' && <div className="fixture-reading-space" aria-hidden="true" />}
          </main>
        </div>
      </ToastProvider>
    </SchoolLmsReadonlyProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
