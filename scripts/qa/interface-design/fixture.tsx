import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from '../../../apps/web/src/components/AppHeader';
import { AcademicNavigation } from '../../../apps/web/src/components/academic/AcademicNavigation';
import { StudentToday } from '../../../apps/web/src/components/today/StudentToday';
import { Button } from '../../../apps/web/src/components/ui/Button';
import { ToastProvider, useToast } from '../../../apps/web/src/components/ui/Toast';
import { Modal, ConfirmModal } from '../../../apps/web/src/components/ui/Modal';
import { Input, Textarea, Select } from '../../../apps/web/src/components/ui/Input';
import { CampusIcon } from '../../../apps/web/src/components/CampusIcon';
import { QuickCampusEntry } from '../../../apps/web/src/components/QuickCampusEntry';
import { PageRecovery } from '../../../apps/web/src/components/PageRecovery';
import { ServiceDirectory } from '../../../apps/web/src/components/ServiceDirectory';
import SearchPage from '../../../apps/web/src/app/search/page';
import {
  applyWebAppearancePreferences,
  defaultWebPreferences,
} from '../../../apps/web/src/lib/webPreferences';
import { SchoolLmsReadonlyProvider } from '../../../apps/web/src/components/SchoolLmsReadonlyProvider';
import { fixtureOptions as query, navigate, usePathname } from './boundaries';
import home from '../../../apps/web/src/app/home.module.css';
import '../../../apps/web/src/app/globals.css';

const now = new Date('2026-11-18T09:00:00+08:00');
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
if (query.get('motion') === 'reduce') document.documentElement.dataset.reducedMotion = 'true';
if (query.get('text') === '200') document.documentElement.style.fontSize = '200%';
if (query.get('font') === 'large') {
  applyWebAppearancePreferences(document, {
    ...defaultWebPreferences.appearance,
    theme: query.get('theme') === 'dark' ? 'dark' : 'light',
    fontSize: 'large',
    animations: query.get('motion') !== 'reduce',
  });
}
const guest = query.get('role') === 'guest';

function Controls() {
  const toast = useToast();
  const [dialog, setDialog] = useState<'form' | 'confirmation' | null>(null);
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
        <Button type="button" variant="outline" onClick={() => navigate('/interface-quick')}>
          檢查快速搜尋
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate('/interface-feedback')}>
          檢查操作回饋
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/library/fixture-missing?schoolId=pu&campus=pu&q=fixture-only')}
        >
          檢查失效連結
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/community/fixture-error?schoolId=pu&campus=pu&q=fixture-only')}
        >
          檢查頁面重試
        </Button>
        <Button type="button" loading>
          儲存中
        </Button>
        <Button type="button" disabled>
          尚未開放
        </Button>
        <Button type="button" variant="outline" onClick={() => setDialog('form')}>
          檢查輸入與對話視窗
        </Button>
        <Button type="button" variant="ghost" onClick={() => setDialog('confirmation')}>
          檢查長篇確認內容
        </Button>
      </div>
      <Modal
        isOpen={dialog === 'form'}
        onClose={() => setDialog(null)}
        title="編輯課程提醒"
        description="確認課程、提醒時間與備註。這些欄位只用於介面驗收。"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              取消編輯
            </Button>
            <Button type="button" onClick={() => setDialog(null)}>
              完成編輯
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 20 }}>
          <Input
            id="fixture-task-title"
            label="提醒名稱"
            defaultValue="下課後整理小組討論紀錄"
            hint="標籤、輸入與提示都應跟隨文字偏好。"
          />
          <Input id="fixture-large-field" label="較大欄位" inputSize="lg" defaultValue="資料結構" />
          <Input id="fixture-small-field" label="較小欄位" inputSize="sm" defaultValue="選填" />
          <Input
            id="fixture-password"
            label="驗收用密碼"
            type="password"
            defaultValue="fixture-only"
            hint="僅為合成文字，沒有登入或帳號寫入。"
          />
          <Input
            id="fixture-icon-field"
            label="教室"
            defaultValue="資訊大樓 I208"
            leftIcon={<CampusIcon name="map" />}
            rightIcon={<CampusIcon name="search" />}
          />
          <Select
            id="fixture-reminder-time"
            label="提醒時間"
            defaultValue="30"
            options={[
              { value: '10', label: '提前 10 分鐘' },
              { value: '30', label: '提前 30 分鐘' },
            ]}
          />
          <Textarea id="fixture-note" label="備註" defaultValue="帶上筆記與上次的討論紀錄。" />
        </div>
      </Modal>
      <ConfirmModal
        isOpen={dialog === 'confirmation'}
        onClose={() => setDialog(null)}
        onConfirm={() => setDialog(null)}
        title="確認移除提醒"
        message={[
          '請先閱讀這份提醒的內容，再決定是否移除。',
          ...Array.from(
            { length: 12 },
            (_, index) =>
              `第 ${index + 1} 項：這是用來檢查較大字體與較短視窗的合成說明，沒有連接任何正式資料。`,
          ),
        ].join('\n\n')}
        confirmText="移除提醒"
        variant="danger"
      />
    </section>
  );
}

function ActionFeedback() {
  const [loading, setLoading] = useState(false);
  return (
    <section aria-label="操作回饋驗收" style={{ display: 'grid', gap: 24, minWidth: 0 }}>
      <div className={home.heading}>
        <h1>操作回饋</h1>
      </div>
      <p className="fixture-copy">下方按鈕只切換處理中狀態，文字、圖示與操作順序保持一致。</p>
      <div>
        <Button type="button" variant="outline" onClick={() => setLoading((current) => !current)}>
          {loading ? '結束處理' : '開始處理'}
        </Button>
      </div>
      <div className="fixture-buttons">
        <Button id="feedback-plain" type="button" variant="primary" loading={loading}>
          儲存提醒
        </Button>
        <Button id="feedback-neighbor" type="button" variant="ghost">
          取消
        </Button>
      </div>
      <div className="fixture-buttons">
        <Button
          id="feedback-left"
          type="button"
          loading={loading}
          icon={<CampusIcon name="calendar" size={18} />}
        >
          加入行程
        </Button>
        <Button
          id="feedback-right"
          type="button"
          variant="outline"
          loading={loading}
          icon={<CampusIcon name="arrow" size={18} />}
          iconPosition="right"
        >
          繼續
        </Button>
        <Button
          id="feedback-icon"
          type="button"
          variant="ghost"
          loading={loading}
          aria-label="重新整理資料"
          icon={<CampusIcon name="search" size={18} />}
        />
      </div>
      <Button id="feedback-full" type="button" fullWidth loading={loading}>
        同步課程與作業
      </Button>
      <div>
        <Button id="feedback-unavailable" type="button" disabled>
          尚未開放
        </Button>
      </div>
    </section>
  );
}

function Fixture() {
  const pathname = usePathname();
  if (pathname === '/search') {
    return (
      <SchoolLmsReadonlyProvider enabled>
        <ToastProvider position="bottom-right">
          <SearchPage />
          <div className={home.main}>
            <Controls />
          </div>
        </ToastProvider>
      </SchoolLmsReadonlyProvider>
    );
  }
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
            ) : pathname === '/interface-quick' ? (
              <>
                <div className={home.heading}>
                  <h1>服務搜尋</h1>
                </div>
                <QuickCampusEntry onAsk={null} />
              </>
            ) : pathname === '/interface-feedback' ? (
              <ActionFeedback />
            ) : pathname === '/life' || pathname === '/connect' ? (
              <>
                <div className={home.heading}>
                  <h1>{pathname === '/life' ? '生活' : '交流'}</h1>
                </div>
                <ServiceDirectory journey={pathname === '/life' ? 'life' : 'connect'} />
              </>
            ) : pathname === '/library/fixture-missing' ? (
              <PageRecovery kind="missing" />
            ) : pathname === '/community/fixture-error' ? (
              <PageRecovery kind="error" onRetry={() => navigate('/')} />
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
