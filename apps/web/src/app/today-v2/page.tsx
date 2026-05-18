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

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CommandBar } from '@/components/ai/CommandBar';
import { SlotCard } from '@/components/ai/SlotCard';

export default function TodayV2Page() {
  const [pinned, setPinned] = useState<string[]>([]);
  const handlePin = (id: string) => {
    setPinned((p) => (p.includes(id) ? p : [...p, id]));
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
                <button className="actionPrimary">🧭 導航</button>
                <button className="actionGhost">課程資料</button>
                <button className="actionGhost">請假</button>
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
                <button className="actionPrimary">📥 加入行事曆</button>
                <button className="actionGhost">AI 排週計畫</button>
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
            actions={<button className="actionGhost">展開全部 12 個</button>}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}
            >
              <CompareOption name="學餐" price="$65" star="⭐ 4.2" time="5 min" />
              <CompareOption
                name="主餐廳 ★"
                price="$95"
                star="⭐ 4.5"
                time="8 min"
                recommended
              />
              <CompareOption name="7-11" price="$45" star="⭐ 3.8" time="2 min" />
            </div>
          </SlotCard>

          {/* Action Card */}
          <SlotCard
            variant="action"
            title="請假草稿（待你確認）"
            icon="📝"
            confidence="mid"
            source={{ name: '從對話自動填入' }}
            actions={
              <>
                <button className="actionGhost">取消</button>
                <button className="actionPrimary">提交給授課老師 →</button>
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
}: {
  name: string;
  price: string;
  star: string;
  time: string;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      style={{
        border: `1px solid ${recommended ? 'var(--ai)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 10,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.18s',
        background: recommended ? 'var(--ai-soft)' : 'var(--surface)',
        font: 'inherit',
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: recommended ? 'var(--ai)' : 'var(--text)',
        }}
      >
        {name}
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
        <div
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
            placeholder="繼續對話..."
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
            aria-label="送出"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--ai-gradient)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ↑
          </button>
        </div>
      </footer>
    </>
  );
}
