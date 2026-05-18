'use client';

/**
 * Campus AI-First — Today v2 Demo
 * --------------------------------
 * 新版「Today」頁面 demo，展示 AI-First 重新設計後的樣貌。
 *
 * 完整文件：docs/design/AI_FIRST_REDESIGN.md
 * 視覺原型：docs/design/prototype.html
 *
 * 此頁面與舊版 / 並存；如要切換，可以把 layout/route 重新指向這裡。
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { CommandBar } from '@/components/ai/CommandBar';
import { SlotCard } from '@/components/ai/SlotCard';
import { useToast } from '@/components/ui';
import { requestLeave } from '@/lib/demoStore';
import { useDemoRole } from '@/lib/demoRole';
import { getDemoUser } from '@/lib/demoData';

// Today v2 主要 demo 課程（c1 = 資料結構 / 王大明 / 工程館 302）
const HERO_COURSE_ID = 'c1';
const HERO_COURSE_NAME = '資料結構';
const HERO_COURSE_ROOM = '工程館 302';
// 請假草稿示範鎖定的課程（c7 = 資料庫系統 / CS303）
const LEAVE_COURSE_ID = 'c7';
const LEAVE_COURSE_NAME = '資料庫系統';
const LEAVE_DATE = '2026-05-21'; // 週四

export default function TodayV2Page() {
  const router = useRouter();
  const { success, info } = useToast();
  const [demoRole] = useDemoRole();
  const me = useMemo(() => getDemoUser(demoRole) ?? getDemoUser('student'), [demoRole]);

  const [pinned, setPinned] = useState<string[]>([]);
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [selectedLunch, setSelectedLunch] = useState<string | null>(null);
  const [leaveDraftState, setLeaveDraftState] = useState<'draft' | 'cancelled' | 'submitted'>(
    'draft',
  );

  const handlePin = (id: string) => {
    setPinned((p) => (p.includes(id) ? p : [...p, id]));
  };

  const goCourse = () => router.push(`/course/${HERO_COURSE_ID}`);
  const goNavigate = () =>
    router.push(`/map?destination=${encodeURIComponent(HERO_COURSE_ROOM)}`);
  const askLeave = () =>
    router.push(`/ai-assistant?q=${encodeURIComponent(`幫我請 ${HERO_COURSE_NAME} 的假`)}`);
  const askWeekPlan = () =>
    router.push(`/ai-assistant?q=${encodeURIComponent('幫我排這週的讀書計畫')}`);
  const goMoreLunch = () => router.push('/cafeteria');

  const addToCalendar = () => {
    setCalendarAdded(true);
    success('已加入行事曆', '3 項本週待辦已寫入你的行事曆');
  };

  const pickLunch = (name: string) => {
    setSelectedLunch(name);
    info('已選擇', `${name} — 5 分鐘後地圖會幫你導航`);
  };

  const cancelLeaveDraft = () => {
    setLeaveDraftState('cancelled');
    info('已取消請假草稿', '草稿不會送出');
  };

  const submitLeaveDraft = () => {
    if (!me) return;
    requestLeave({
      courseId: LEAVE_COURSE_ID,
      courseName: LEAVE_COURSE_NAME,
      studentId: me.uid,
      studentName: me.displayName,
      reason: '病假（AI 草稿）',
      dateFrom: LEAVE_DATE,
      dateTo: LEAVE_DATE,
    });
    setLeaveDraftState('submitted');
    success('請假已送出', `${LEAVE_COURSE_NAME} 老師已收到通知`);
  };

  return (
    <AppShell rightDrawer={<AiDrawerDemo />}>
      <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 16 }}>
        <CommandBar
          quickChips={[
            { id: 'next', label: '下節課在哪？' },
            { id: 'week', label: '這週還要交什麼？' },
            { id: 'leave', label: '幫我請週四的假' },
            { id: 'lunch', label: '中午吃什麼便宜營養' },
          ]}
        />

        {/* Hero */}
        <section
          aria-label="今日總覽"
          style={{
            marginTop: 24,
            padding: '28px 32px',
            background: 'var(--ai-gradient-soft)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 200,
              height: 200,
              background: 'var(--ai-gradient)',
              opacity: 0.08,
              borderRadius: '50%',
              filter: 'blur(40px)',
            }}
          />
          <div
            style={{
              fontSize: 12,
              color: 'var(--ai)',
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Today · 週一 5/18 早安
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              margin: '8px 0',
              letterSpacing: -0.4,
              color: 'var(--text)',
            }}
          >
            今天 3 堂課、2 份作業，
            <br />
            AI 幫你排好了。
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            下節課 09:10 資料結構 工程館 302（步行 4 分鐘） · 23:59 截止 Lab 3 進度 60%
          </p>
        </section>

        {/* Slot Cards Grid */}
        <section
          aria-label="AI 為你準備的卡片"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          {/* Answer Card */}
          <SlotCard
            variant="answer"
            title="下節課"
            icon="⏰"
            confidence="high"
            source={{ name: '教務系統', timestamp: new Date() }}
            onPinToToday={() => handlePin('next-class')}
            actions={
              <>
                <button type="button" className="actionPrimary" onClick={goNavigate}>
                  🧭 導航
                </button>
                <button type="button" className="actionGhost" onClick={goCourse}>
                  課程資料
                </button>
                <button type="button" className="actionGhost" onClick={askLeave}>
                  請假
                </button>
              </>
            }
          >
            <strong>資料結構</strong> · 09:10–10:50
            <br />
            📍 工程館 302（步行 4 分鐘）
            <br />
            👨‍🏫 王大明老師
          </SlotCard>

          {/* Schedule Card */}
          <SlotCard
            variant="schedule"
            title="本週待辦"
            icon="📅"
            confidence="high"
            source={{ name: 'LMS', timestamp: new Date() }}
            onPinToToday={() => handlePin('week-todo')}
            actions={
              <>
                <button
                  type="button"
                  className="actionPrimary"
                  onClick={addToCalendar}
                  disabled={calendarAdded}
                  style={calendarAdded ? { opacity: 0.7, cursor: 'default' } : undefined}
                >
                  {calendarAdded ? '✅ 已加入行事曆' : '📥 加入行事曆'}
                </button>
                <button type="button" className="actionGhost" onClick={askWeekPlan}>
                  AI 排週計畫
                </button>
              </>
            }
          >
            <ScheduleRow
              when="週三 23:59"
              text="作業系統 Lab 3"
              tag="未開始"
              tone="warn"
            />
            <ScheduleRow
              when="週四 09:00"
              text="資料庫小考"
              tag="已準備"
              tone="done"
            />
            <ScheduleRow
              when="週五 14:00"
              text="專題期中報告 60%"
              tag="進行中"
              tone="todo"
            />
          </SlotCard>

          {/* Compare Card */}
          <SlotCard
            variant="compare"
            title="中午選擇 · 3 個建議"
            icon="🍱"
            confidence="mid"
            source={{ name: '餐廳資料 + 你的偏好', timestamp: new Date() }}
            onPinToToday={() => handlePin('lunch')}
            actions={
              <button type="button" className="actionGhost" onClick={goMoreLunch}>
                展開全部 12 個
              </button>
            }
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}
            >
              <CompareOption
                name="學餐"
                price="$65"
                star="⭐ 4.2"
                time="5 min"
                selected={selectedLunch === '學餐'}
                onSelect={() => pickLunch('學餐')}
              />
              <CompareOption
                name="主餐廳 ★"
                price="$95"
                star="⭐ 4.5"
                time="8 min"
                recommended
                selected={selectedLunch === '主餐廳 ★'}
                onSelect={() => pickLunch('主餐廳 ★')}
              />
              <CompareOption
                name="7-11"
                price="$45"
                star="⭐ 3.8"
                time="2 min"
                selected={selectedLunch === '7-11'}
                onSelect={() => pickLunch('7-11')}
              />
            </div>
          </SlotCard>

          {/* Action Card */}
          <SlotCard
            variant="action"
            title={
              leaveDraftState === 'submitted'
                ? '請假草稿（已送出）'
                : leaveDraftState === 'cancelled'
                  ? '請假草稿（已取消）'
                  : '請假草稿（待你確認）'
            }
            icon="📝"
            confidence="mid"
            source={{ name: '從對話自動填入' }}
            actions={
              leaveDraftState === 'draft' ? (
                <>
                  <button type="button" className="actionGhost" onClick={cancelLeaveDraft}>
                    取消
                  </button>
                  <button type="button" className="actionPrimary" onClick={submitLeaveDraft}>
                    提交給授課老師 →
                  </button>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    ⚠ AI 不會自動送出
                  </span>
                </>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    color: leaveDraftState === 'submitted' ? 'var(--success)' : 'var(--muted)',
                  }}
                >
                  {leaveDraftState === 'submitted'
                    ? `✅ 已送出給 ${LEAVE_COURSE_NAME} 老師，等待回覆`
                    : '✕ 已取消，未送出'}
                </span>
              )
            }
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}
            >
              <div>
                <strong>日期：</strong>5/22（週四）
              </div>
              <div>
                <strong>課程：</strong>資料庫系統 (CS302)
              </div>
              <div>
                <strong>事由：</strong>病假
              </div>
              <div>
                <strong>附件：</strong>診斷證明（選用）
              </div>
            </div>
          </SlotCard>
        </section>

        {pinned.length > 0 && (
          <div
            role="status"
            style={{
              marginTop: 20,
              padding: 12,
              borderRadius: 'var(--radius-md)',
              background: 'var(--ai-soft)',
              color: 'var(--ai)',
              fontSize: 13,
            }}
          >
            ✨ 已釘到 Today {pinned.length} 張卡片：{pinned.join(', ')}
          </div>
        )}

        <footer
          style={{
            marginTop: 40,
            padding: '20px 0',
            borderTop: '1px solid var(--border)',
            color: 'var(--muted)',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          這是 AI-First Redesign demo · 設計總綱：docs/design/AI_FIRST_REDESIGN.md
        </footer>

        <style jsx global>{`
          .actionPrimary {
            padding: 8px 14px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
            background: var(--ai);
            color: white;
            border: 1px solid var(--ai);
            cursor: pointer;
            font-family: inherit;
            transition: background 0.15s;
          }
          .actionPrimary:hover {
            background: var(--ai-strong);
          }
          .actionGhost {
            padding: 8px 14px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
            background: var(--surface);
            color: var(--text);
            border: 1px solid var(--border);
            cursor: pointer;
            font-family: inherit;
            transition: background 0.15s;
          }
          .actionGhost:hover {
            background: var(--panel);
          }
        `}</style>
      </div>
    </AppShell>
  );
}

function ScheduleRow({
  when,
  text,
  tag,
  tone,
}: {
  when: string;
  text: string;
  tag: string;
  tone: 'todo' | 'warn' | 'done';
}) {
  const toneMap = {
    todo: { dot: 'var(--ai)', bg: 'var(--ai-soft)', color: 'var(--ai)' },
    warn: {
      dot: 'var(--warning)',
      bg: 'rgba(255,149,0,0.12)',
      color: 'var(--warning)',
    },
    done: {
      dot: 'var(--success)',
      bg: 'rgba(52,199,89,0.12)',
      color: 'var(--success)',
    },
  };
  const t = toneMap[tone];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0',
        fontSize: 13,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)', width: 80, flexShrink: 0 }}>
        {when}
      </span>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: t.dot,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1 }}>{text}</span>
      <span
        style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 6,
          fontWeight: 600,
          background: t.bg,
          color: t.color,
        }}
      >
        {tag}
      </span>
    </div>
  );
}

function CompareOption({
  name,
  price,
  star,
  time,
  recommended,
  selected,
  onSelect,
}: {
  name: string;
  price: string;
  star: string;
  time: string;
  recommended?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const highlight = selected || recommended;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        border: `${selected ? 2 : 1}px solid ${highlight ? 'var(--ai)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 10,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.18s',
        background: selected
          ? 'rgba(94,106,210,0.18)'
          : recommended
            ? 'var(--ai-soft)'
            : 'var(--surface)',
        font: 'inherit',
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: highlight ? 'var(--ai)' : 'var(--text)',
        }}
      >
        {selected ? `✓ ${name}` : name}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ai)', marginTop: 4 }}>
        {price}
      </div>
      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>{star}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{time}</div>
    </button>
  );
}

function AiDrawerDemo() {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    router.push(`/ai-assistant?q=${encodeURIComponent(q)}`);
  };
  return (
    <>
      <header
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--ai-gradient)',
            animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>校園 AI</div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--success)',
              }}
            />
            線上 · 已連結 7 個系統
          </div>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              background: 'var(--ai-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            早安王同學 ☀️ 今天我幫你抓到幾件重要的事，已放在 Today 區塊。要先聊哪一件？
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            校園 AI · 09:43
          </div>
        </div>

        <div style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
          <div
            style={{
              background: 'var(--ai)',
              color: 'white',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: 14,
            }}
          >
            幫我看週四能不能蹺資料庫的課
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--muted)',
              marginTop: 4,
              textAlign: 'right',
            }}
          >
            你 · 09:43
          </div>
        </div>

        <div>
          <div
            style={{
              background: 'var(--ai-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            我查了你的出缺勤紀錄：
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 12,
                background: 'var(--surface)',
                marginTop: 8,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                📊 資料庫 (CS302) 出席
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>
                已上 <strong style={{ color: 'var(--text)' }}>13/15 週</strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>
                缺席上限：<strong style={{ color: 'var(--text)' }}>3 次</strong>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--warning)',
                  margin: '6px 0 0',
                }}
              >
                ⚠️ 蹺一次後就不能再缺席
              </div>
            </div>
            <div style={{ marginTop: 8 }}>要我幫你生請假草稿嗎？</div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            校園 AI · 09:43 · 高信心 ✓
          </div>
        </div>
      </div>

      <footer style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: 'var(--panel)',
            borderRadius: 'var(--radius-pill)',
            padding: '8px 12px',
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="繼續對話..."
            aria-label="向 AI 提問"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 14,
              fontFamily: 'inherit',
              color: 'var(--text)',
            }}
          />
          <button
            type="submit"
            aria-label="送出"
            disabled={!draft.trim()}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--ai-gradient)',
              color: 'white',
              border: 'none',
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              fontSize: 13,
              opacity: draft.trim() ? 1 : 0.5,
            }}
          >
            ↑
          </button>
        </form>
      </footer>
    </>
  );
}
