'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ORAL_EXAM_ACCOUNTS,
  ORAL_EXAM_AI_CONTEXT,
  ORAL_EXAM_ANNOUNCEMENTS,
  ORAL_EXAM_ASSIGNMENTS,
  ORAL_EXAM_ATTENDANCE,
  ORAL_EXAM_CALENDAR,
  ORAL_EXAM_CLUB,
  ORAL_EXAM_COURSES,
  ORAL_EXAM_DMS,
  ORAL_EXAM_FEED,
  ORAL_EXAM_GRADEBOOK,
  ORAL_EXAM_LEAVE,
  ORAL_EXAM_LOST_FOUND,
  ORAL_EXAM_MENU,
  ORAL_EXAM_OPS_SNAPSHOT,
  ORAL_EXAM_ORDERS,
  ORAL_EXAM_PLAY_DEFAULT,
  ORAL_EXAM_SCHOOL_NAME,
  ORAL_EXAM_STORAGE_KEY,
  ORAL_EXAM_STORIES,
  ORAL_EXAM_TENANT_ID,
  ORAL_EXAM_WEB_PATH,
  emptyOralExamPlayState,
  getOralExamAccount,
  parseOralExamRole,
  type OralExamPlayState,
  type OralExamRole,
} from '@campus/shared/src/oralExamDemo';
import { SiteShell } from '@/components/SiteShell';
import styles from './oralExam.module.css';

function readPlayState(): OralExamPlayState {
  if (typeof window === 'undefined') return emptyOralExamPlayState();
  try {
    const raw = window.localStorage.getItem(ORAL_EXAM_STORAGE_KEY);
    if (!raw) return emptyOralExamPlayState();
    return { ...ORAL_EXAM_PLAY_DEFAULT, ...(JSON.parse(raw) as Partial<OralExamPlayState>) };
  } catch {
    return emptyOralExamPlayState();
  }
}

function writePlayState(next: OralExamPlayState) {
  window.localStorage.setItem(ORAL_EXAM_STORAGE_KEY, JSON.stringify(next));
}

export function OralExamPlayground() {
  const params = useSearchParams();
  const role = parseOralExamRole(params.get('role'));
  const account = getOralExamAccount(role);
  const [play, setPlay] = useState<OralExamPlayState>(readPlayState);

  const update = (patch: Partial<OralExamPlayState>) => {
    setPlay((current) => {
      const next = { ...current, ...patch };
      writePlayState(next);
      return next;
    });
  };

  const assistantAnswer = useMemo(() => {
    const base = ORAL_EXAM_AI_CONTEXT[role];
    const extras = [
      play.attendanceCheckedIn ? '王小明已完成今日資料結構簽到。' : null,
      play.assignmentSubmitted ? '鏈結串列作業已繳交，等待教師批改。' : null,
      play.gradePublished ? '資料庫作業二成績 82 分已發布。' : null,
      play.leaveApproved ? '11/13 病假已核准。' : play.leaveRequested ? '11/13 病假待審。' : null,
      play.orderReady ? '咖哩雞腿飯示範訂單可取餐。' : null,
    ].filter(Boolean);
    return extras.length ? `${base} ${extras.join(' ')}` : base;
  }, [play, role]);

  return (
    <SiteShell
      title="口試示範工作區"
      subtitle="本機示範資料，不登入真實校園，也不寫入正式資料庫。"
      schoolName={ORAL_EXAM_SCHOOL_NAME}
    >
      <section className={styles.banner} aria-label="示範範圍">
        <strong>示範租戶 {ORAL_EXAM_TENANT_ID}</strong>
        <p>
          姓名皆帶「示範」前綴。學號為 DEMO1140001 這類標籤，不是真實學號。線上點餐、學號登入與
          TronClass／E-campus 連線維持關閉。校方與平台營運只能看到這個租戶。
        </p>
      </section>
      <nav className={styles.roles} aria-label="示範角色">
        {ORAL_EXAM_ACCOUNTS.map((item) => (
          <Link
            key={item.role}
            href={`${ORAL_EXAM_WEB_PATH}?role=${item.role}`}
            aria-current={item.role === role ? 'page' : undefined}
          >
            {item.title} · {item.displayName}
          </Link>
        ))}
      </nav>
      <div className={styles.identity}>
        <h2>
          {account.title}：{account.displayName}
        </h2>
        <p className={styles.muted}>
          {account.department} · {account.demoId} · {account.email}
        </p>
      </div>
      <RoleWorkspace
        role={role}
        play={play}
        update={update}
        assistantAnswer={assistantAnswer}
        onReset={() => {
          writePlayState(emptyOralExamPlayState());
          setPlay(emptyOralExamPlayState());
        }}
      />
    </SiteShell>
  );
}

function RoleWorkspace({
  role,
  play,
  update,
  assistantAnswer,
  onReset,
}: {
  role: OralExamRole;
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
  assistantAnswer: string;
  onReset: () => void;
}) {
  return (
    <div className={styles.grid}>
      {role === 'student' ? <StudentPanels play={play} update={update} /> : null}
      {role === 'teacher' ? <TeacherPanels play={play} update={update} /> : null}
      {role === 'school_admin' ? <SchoolAdminPanels play={play} update={update} /> : null}
      {role === 'merchant' ? <MerchantPanels play={play} update={update} /> : null}
      {role === 'ops' ? <OpsPanels /> : null}
      <section className={styles.card}>
        <h2>校園助理（示範脈絡）</h2>
        <p>{assistantAnswer}</p>
      </section>
      <section className={`${styles.card} ${styles.script}`}>
        <h2>這角色接下來點什麼</h2>
        <ol className={styles.list}>
          {getOralExamAccount(role).clicks.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className={styles.status}>動作只寫在這個瀏覽器的本機示範狀態，可用下方按鈕還原。</p>
        <button type="button" className={styles.reset} onClick={onReset}>
          還原示範狀態
        </button>
      </section>
    </div>
  );
}

function StudentPanels({
  play,
  update,
}: {
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
}) {
  return (
    <>
      <section className={styles.card}>
        <h2>課表</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_COURSES.map((course) => (
            <li key={course.id}>
              {course.day} {course.period} · {course.name}（{course.instructor} · {course.room}）
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card}>
        <h2>作業與繳交</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_ASSIGNMENTS.map((item) => (
            <li key={item.id}>
              {item.courseName} · {item.title} · 截止 {item.due}
              {item.id === 'oral-exam-hw-list'
                ? play.assignmentSubmitted
                  ? ' · 已繳交'
                  : ' · 待繳交'
                : play.gradePublished
                  ? ' · 82 分已發布'
                  : ` · ${item.studentStatus}`}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={play.assignmentSubmitted}
            onClick={() => update({ assignmentSubmitted: true })}
          >
            繳交鏈結串列作業
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>點名與請假</h2>
        <p>
          {ORAL_EXAM_ATTENDANCE.courseName} {ORAL_EXAM_ATTENDANCE.sessionTitle}：
          {play.attendanceCheckedIn ? '已簽到' : '進行中，尚未簽到'}
        </p>
        <p>
          {ORAL_EXAM_LEAVE.date} {ORAL_EXAM_LEAVE.courseName}病假：
          {play.leaveApproved ? '已核准' : play.leaveRequested ? '已送出，待教師審核' : '尚未送出'}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={play.attendanceCheckedIn}
            onClick={() => update({ attendanceCheckedIn: true })}
          >
            簽到
          </button>
          <button
            type="button"
            disabled={play.leaveRequested || play.leaveApproved}
            onClick={() => update({ leaveRequested: true })}
          >
            送出病假
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>行事曆、社團、限時動態與私訊</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_CALENDAR.map((item) => (
            <li key={item.id}>
              {item.title} · {item.when}
            </li>
          ))}
          {ORAL_EXAM_FEED.map((item) => (
            <li key={item.id}>
              {ORAL_EXAM_CLUB.name}動態 · {item.author}：{item.body}
            </li>
          ))}
          {ORAL_EXAM_STORIES.map((item) => (
            <li key={item.id}>
              限時動態 · {item.author}：{item.caption}
              {play.storyPosted && item.id === 'oral-exam-story-1' ? ' · 已新增一則' : ''}
            </li>
          ))}
          {ORAL_EXAM_DMS.map((item) => (
            <li key={item.id}>
              私訊 · {item.from}：{item.preview}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" disabled={play.storyPosted} onClick={() => update({ storyPosted: true })}>
            發一則示範限時動態
          </button>
          <button type="button" disabled={play.dmSent} onClick={() => update({ dmSent: true })}>
            回覆林宏志「晚上會到」
          </button>
        </div>
        {play.dmSent ? <p className={styles.status}>已傳送給示範學生林宏志。</p> : null}
      </section>
      <section className={styles.card}>
        <h2>餐飲與失物招領</h2>
        <p className={styles.muted}>線上點餐關閉；這裡只展示菜單與預先備好的示範訂單。</p>
        <ul className={styles.list}>
          {ORAL_EXAM_MENU.map((item) => (
            <li key={item.id}>
              {item.name} ${item.price} · {item.note}
            </li>
          ))}
          <li>
            訂單：咖哩雞腿飯 · {play.orderReady ? '可取餐' : ORAL_EXAM_ORDERS[0].status} ·{' '}
            {ORAL_EXAM_ORDERS[0].pickup}
          </li>
          {ORAL_EXAM_LOST_FOUND.map((item) => (
            <li key={item.id}>
              {item.type} · {item.title} · {item.place}
              {play.lostFoundClaimed && item.id === 'oral-exam-lf-1' ? ' · 已申請認領' : ` · ${item.status}`}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={play.lostFoundClaimed}
            onClick={() => update({ lostFoundClaimed: true })}
          >
            申請認領耳機盒
          </button>
        </div>
      </section>
    </>
  );
}

function TeacherPanels({
  play,
  update,
}: {
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
}) {
  return (
    <>
      <section className={styles.card}>
        <h2>成績冊</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_GRADEBOOK.map((row) => (
            <li key={row.demoId}>
              {row.studentName}（{row.demoId}）作業二 {row.hw2} 分
              {row.studentName === '示範學生王小明'
                ? play.gradePublished
                  ? ' · 作業二已發布'
                  : play.assignmentSubmitted
                    ? ' · 作業三已繳交待批'
                    : ' · 作業三未繳'
                : ` · 作業三 ${row.hw3 ?? '—'} 分`}
              · {row.attendance}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" disabled={play.gradePublished} onClick={() => update({ gradePublished: true })}>
            發布王小明作業二成績 82 分
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>點名</h2>
        <p>
          {ORAL_EXAM_ATTENDANCE.sessionTitle}：已到 {ORAL_EXAM_ATTENDANCE.present.join('、')}
          {play.attendanceCheckedIn ? '、示範學生王小明' : '；王小明尚未簽到'}
        </p>
      </section>
      <section className={styles.card}>
        <h2>請假審核</h2>
        <p>
          {ORAL_EXAM_LEAVE.studentName} {ORAL_EXAM_LEAVE.date} {ORAL_EXAM_LEAVE.reason}
        </p>
        <p className={styles.status}>
          {play.leaveApproved ? '已核准' : play.leaveRequested ? '學生已送出，待你審核' : '學生尚未送出（可先切到學生角色送出）'}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={play.leaveApproved || !play.leaveRequested}
            onClick={() => update({ leaveApproved: true })}
          >
            核准病假
          </button>
        </div>
      </section>
    </>
  );
}

function SchoolAdminPanels({
  play,
  update,
}: {
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
}) {
  return (
    <>
      <section className={styles.card}>
        <h2>校園公告與行事曆</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_ANNOUNCEMENTS.map((item) => (
            <li key={item.id}>
              {item.title} · {item.source}
            </li>
          ))}
          {play.announcementPosted ? <li>已發布：【示範】今晚資訊館空調維護延長至 21:00</li> : null}
          {ORAL_EXAM_CALENDAR.map((item) => (
            <li key={item.id}>
              {item.title} · {item.when} · {item.place}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={play.announcementPosted}
            onClick={() => update({ announcementPosted: true })}
          >
            發布示範公告
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>示範租戶人員</h2>
        <p className={styles.muted}>只列出 nuni-oral-exam。沒有真實學生名冊。</p>
        <ul className={styles.list}>
          {ORAL_EXAM_ACCOUNTS.map((item) => (
            <li key={item.uid}>
              {item.displayName} · {item.title} · {item.demoId}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function MerchantPanels({
  play,
  update,
}: {
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
}) {
  return (
    <>
      <section className={styles.card}>
        <h2>菜單</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_MENU.map((item) => (
            <li key={item.id}>
              {item.name} ${item.price} · {item.note}
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card}>
        <h2>進店訂單（示範備餐單）</h2>
        <ul className={styles.list}>
          {ORAL_EXAM_ORDERS.map((item) => (
            <li key={item.id}>
              {item.customer} · {item.items} ·{' '}
              {item.id === 'oral-exam-order-1' && play.orderReady ? '可取餐' : item.status}
            </li>
          ))}
        </ul>
        <p className={styles.muted}>{ORAL_EXAM_ORDERS[0].note}</p>
        <div className={styles.actions}>
          <button type="button" disabled={play.orderReady} onClick={() => update({ orderReady: true })}>
            標為可取餐
          </button>
        </div>
      </section>
    </>
  );
}

function OpsPanels() {
  return (
    <>
      <section className={styles.card}>
        <h2>示範租戶健康</h2>
        <ul className={styles.list}>
          <li>租戶：{ORAL_EXAM_OPS_SNAPSHOT.tenant}</li>
          <li>學校：{ORAL_EXAM_OPS_SNAPSHOT.school}</li>
          <li>資料範圍：{ORAL_EXAM_OPS_SNAPSHOT.taggedDocuments}</li>
          <li>其他租戶可見：否</li>
          <li>線上點餐：關</li>
          <li>學號登入：關</li>
          <li>校務連線：關</li>
        </ul>
      </section>
      <section className={styles.card}>
        <h2>其他租戶</h2>
        <p>這個示範營運台沒有真實學校、真實使用者或正式訂單。正式 /admin/ops 仍需平台營運帳號，權限規則沒有放寬。</p>
      </section>
    </>
  );
}
