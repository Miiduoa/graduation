'use client';

/**
 * Campus AI-First — Home (/)
 * --------------------------
 * 主入口已換成 AI-First 設計。
 *
 * 完整設計文件：docs/design/AI_FIRST_REDESIGN.md
 * 視覺原型：docs/design/prototype.html
 *
 * 舊版 page.legacy.tsx 已下架，僅保留 5 行 stub。
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { CommandBar } from '@/components/ai/CommandBar';
import { SlotCard } from '@/components/ai/SlotCard';

export default function HomePage() {
  const router = useRouter();
  const [pinned, setPinned] = useState<string[]>([]);
  const [leaveSubmitted, setLeaveSubmitted] = useState(false);
  const [pickedLunch, setPickedLunch] = useState<string | null>(null);

  const handlePin = (id: string) =>
    setPinned((p) => (p.includes(id) ? p : [...p, id]));

  // 統一的路由 / 動作 handler — 避免 button 沒有 onClick 而看起來壞掉
  const go = useCallback(
    (path: string) => () => {
      try {
        router.push(path);
      } catch (err) {
        console.warn('[HomePage] router.push failed', path, err);
      }
    },
    [router],
  );

  const submitLeave = useCallback(() => {
    setLeaveSubmitted(true);
    // 後端 API 串接前先給使用者明確 feedback，不要靜默
    setTimeout(() => setLeaveSubmitted(false), 4000);
  }, []);

  return (
    <AppShell rightDrawer={<AiDrawer />}>
      <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 16 }}>
        <CommandBar
          quickChips={[
            { id: 'next', label: '下節課在哪？' },
            { id: 'week', label: '這週還要交什麼？' },
            { id: 'leave', label: '幫我請週四的假' },
            { id: 'lunch', label: '中午吃什麼便宜營養' },
          ]}
        />

        {/* Legacy switch hint — 過渡期顯示 */}
        <div
          role="note"
          style={{
            marginTop: 12,
            padding: '6px 14px',
            fontSize: 11,
            color: 'var(--muted)',
            background: 'var(--ai-soft)',
            borderRadius: 'var(--radius-pill)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--ai)', fontWeight: 600 }}>✨ AI-First v1</span>
          <span>·</span>
          <span>新版設計已上線</span>
        </div>

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
            Today · {new Date().toLocaleDateString('zh-TW', { weekday: 'long', month: 'long', day: 'numeric' })}
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

        {/* Slot Cards */}
        <section
          aria-label="AI 為你準備的卡片"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          <SlotCard
            variant="answer"
            title="下節課"
            icon="⏰"
            confidence="high"
            source={{ name: '教務系統', timestamp: new Date() }}
            onPinToToday={() => handlePin('next-class')}
            actions={
              <>
                <button
                  type="button"
                  className="actionPrimary"
                  onClick={go('/map?building=eng302')}
                >
                  🧭 導航
                </button>
                <button
                  type="button"
                  className="actionGhost"
                  onClick={go('/course/CS302')}
                >
                  課程資料
                </button>
                <button
                  type="button"
                  className="actionGhost"
                  onClick={go('/today-v2?action=leave')}
                >
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
                  onClick={go('/timetable?addToCalendar=1')}
                >
                  📥 加入行事曆
                </button>
                <button
                  type="button"
                  className="actionGhost"
                  onClick={go('/ai-assistant?prompt=help-me-plan-this-week')}
                >
                  AI 排週計畫
                </button>
              </>
            }
          >
            <ScheduleRow when="週三 23:59" text="作業系統 Lab 3" tag="未開始" tone="warn" />
            <ScheduleRow when="週四 09:00" text="資料庫小考" tag="已準備" tone="done" />
            <ScheduleRow when="週五 14:00" text="專題期中報告 60%" tag="進行中" tone="todo" />
          </SlotCard>

          <SlotCard
            variant="compare"
            title="中午選擇 · 3 個建議"
            icon="🍱"
            confidence="mid"
            source={{ name: '餐廳 + 你的偏好', timestamp: new Date() }}
            onPinToToday={() => handlePin('lunch')}
            actions={
              <button
                type="button"
                className="actionGhost"
                onClick={go('/cafeteria')}
              >
                展開全部 12 個
              </button>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <CompareOption
                name="學餐"
                price="$65"
                star="⭐ 4.2"
                time="5 min"
                onClick={() => setPickedLunch('學餐')}
                picked={pickedLunch === '學餐'}
              />
              <CompareOption
                name="主餐廳 ★"
                price="$95"
                star="⭐ 4.5"
                time="8 min"
                recommended
                onClick={() => setPickedLunch('主餐廳')}
                picked={pickedLunch === '主餐廳'}
              />
              <CompareOption
                name="7-11"
                price="$45"
                star="⭐ 3.8"
                time="2 min"
                onClick={() => setPickedLunch('7-11')}
                picked={pickedLunch === '7-11'}
              />
            </div>
            {pickedLunch && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ai)' }}>
                ✓ 已選擇：{pickedLunch}（再次點擊可換選）
              </div>
            )}
          </SlotCard>

          <SlotCard
            variant="action"
            title="請假草稿（待你確認）"
            icon="📝"
            confidence="mid"
            source={{ name: '從對話自動填入' }}
            actions={
              <>
                <button
                  type="button"
                  className="actionGhost"
                  onClick={() => setLeaveSubmitted(false)}
                  disabled={leaveSubmitted}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="actionPrimary"
                  onClick={submitLeave}
                  disabled={leaveSubmitted}
                >
                  {leaveSubmitted ? '已送出 ✓' : '提交給授課老師 →'}
                </button>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
                  ⚠ AI 不會自動送出
                </span>
              </>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><strong>日期：</strong>5/22（週四）</div>
              <div><strong>課程：</strong>資料庫系統 (CS302)</div>
              <div><strong>事由：</strong>病假</div>
              <div><strong>附件：</strong>診斷證明（選用）</div>
            </div>
            {leaveSubmitted && (
              <div
                role="status"
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: 'var(--ai-soft)',
                  color: 'var(--ai)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                ✓ 草稿已送出給授課老師（後端真實串接前為 demo 行為）
              </div>
            )}
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
            ✨ 已釘到 Today {pinned.length} 張卡片
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
          Campus AI-First v1 · 設計總綱：<code>docs/design/AI_FIRST_REDESIGN.md</code>
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
          .actionPrimary:hover { background: var(--ai-strong); }
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
          .actionGhost:hover { background: var(--panel); }
        `}</style>
      </div>
    </AppShell>
  );
}

function ScheduleRow({
  when, text, tag, tone,
}: {
  when: string; text: string; tag: string; tone: 'todo' | 'warn' | 'done';
}) {
  const map = {
    todo: { dot: 'var(--ai)', bg: 'var(--ai-soft)', color: 'var(--ai)' },
    warn: { dot: 'var(--warning)', bg: 'rgba(255,149,0,0.12)', color: 'var(--warning)' },
    done: { dot: 'var(--success)', bg: 'rgba(52,199,89,0.12)', color: 'var(--success)' },
  };
  const t = map[tone];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', fontSize: 13 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', width: 80, flexShrink: 0 }}>{when}</span>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{text}</span>
      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 600, background: t.bg, color: t.color }}>
        {tag}
      </span>
    </div>
  );
}

function CompareOption({
  name, price, star, time, recommended, onClick, picked,
}: {
  name: string;
  price: string;
  star: string;
  time: string;
  recommended?: boolean;
  onClick?: () => void;
  picked?: boolean;
}) {
  const highlighted = picked || recommended;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      style={{
        border: `2px solid ${picked ? 'var(--ai)' : recommended ? 'var(--ai)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 10,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.18s',
        background: highlighted ? 'var(--ai-soft)' : 'var(--surface)',
        font: 'inherit',
        color: 'var(--text)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: highlighted ? 'var(--ai)' : 'var(--text)' }}>
        {name}{picked ? ' ✓' : ''}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ai)', marginTop: 4 }}>{price}</div>
      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>{star}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{time}</div>
    </button>
  );
}

type DrawerMsg = { id: string; role: 'user' | 'ai'; text: string; at: Date };

function AiDrawer() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<DrawerMsg[]>([
    {
      id: 'seed-1',
      role: 'ai',
      text: '早安王同學 ☀️ 今天我幫你抓到幾件重要的事，已放在 Today 區塊。要先聊哪一件？',
      at: new Date(),
    },
  ]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const userMsg: DrawerMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      at: new Date(),
    };
    const aiStub: DrawerMsg = {
      id: `a-${Date.now() + 1}`,
      role: 'ai',
      text: '收到，AI 後端串接前先記下：「' + text + '」',
      at: new Date(),
    };
    setMessages((prev) => [...prev, userMsg, aiStub]);
    setInput('');
  }, [input]);

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
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--ai-gradient)',
            animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>校園 AI</div>
          <div style={{ fontSize: 11, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
            線上 · 已連結 7 個系統
          </div>
        </div>
      </header>

      <div
        style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {messages.map((m) =>
          m.role === 'ai' ? (
            <div key={m.id}>
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
                {m.text}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                校園 AI · {m.at.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ) : (
            <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
              <div
                style={{
                  background: 'var(--ai)',
                  color: 'white',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                }}
              >
                {m.text}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                你 · {m.at.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ),
        )}
      </div>

      <footer style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'var(--panel)', borderRadius: 'var(--radius-pill)', padding: '8px 12px',
        }}>
          <input
            placeholder="繼續對話..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            style={{
              flex: 1, border: 'none', background: 'transparent',
              outline: 'none', fontSize: 14, fontFamily: 'inherit', color: 'var(--text)',
            }}
          />
          <button
            type="button"
            aria-label="送出"
            onClick={send}
            disabled={!input.trim()}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--ai-gradient)', color: 'white',
              border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed',
              fontSize: 13,
              opacity: input.trim() ? 1 : 0.5,
            }}
          >
            ↑
          </button>
        </div>
      </footer>
    </>
  );
}
