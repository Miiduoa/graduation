'use client';

/**
 * Campus AI-First — Global Command Bar
 * --------------------------------------
 * 永遠置頂的 AI 對話入口。Cmd+K 觸發全屏，點擊 inline 觸發 drawer。
 *
 * 設計規範對應：docs/design/AI_FIRST_REDESIGN.md §3 Navigation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type QuickChip = {
  id: string;
  label: string;
  intent?: string; // AI 收到後展開成完整 query
};

type CommandBarProps = {
  placeholder?: string;
  /** 快速 chip — 根據時間 / 角色 / 上下文由父層提供 */
  quickChips?: QuickChip[];
  /** 點 chip 或送出時 callback；未提供則導向 /ai-assistant */
  onSubmit?: (text: string, source: 'chip' | 'type' | 'voice') => void;
  /** 顯示模式 */
  variant?: 'inline' | 'sticky';
};

const DEFAULT_CHIPS: QuickChip[] = [
  { id: 'next-class', label: '下節課在哪？' },
  { id: 'this-week', label: '這週還要交什麼？' },
  { id: 'leave', label: '幫我請週四的假' },
  { id: 'lunch', label: '中午吃什麼便宜營養' },
];

export function CommandBar({
  placeholder = '問校園 AI 任何事…',
  quickChips = DEFAULT_CHIPS,
  onSubmit,
  variant = 'sticky',
}: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const submit = useCallback(
    (text: string, source: 'chip' | 'type' | 'voice') => {
      const q = text.trim();
      if (!q) return;
      if (onSubmit) {
        onSubmit(q, source);
      } else {
        router.push(`/ai-assistant?q=${encodeURIComponent(q)}`);
      }
      setOpen(false);
      setValue('');
    },
    [onSubmit, router],
  );

  // Cmd+K / Ctrl+K → open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 30);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const containerStyle = useMemo<React.CSSProperties>(
    () =>
      variant === 'sticky'
        ? {
            position: 'sticky',
            top: 0,
            zIndex: 50,
            background: 'rgba(248,249,252,0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '16px 0',
          }
        : { padding: '0' },
    [variant],
  );

  return (
    <>
      <div style={containerStyle}>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 30);
          }}
          aria-label="開啟 AI Command（Cmd+K）"
          style={{
            width: '100%',
            height: 52,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'text',
            transition: 'all 0.2s var(--ai-ease-out)',
            boxShadow: 'var(--shadow-sm)',
            color: 'var(--muted)',
            font: 'inherit',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--ai)';
            e.currentTarget.style.boxShadow = 'var(--shadow-ai)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <span
            aria-hidden
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'var(--ai-gradient)',
              flexShrink: 0,
              animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
            }}
          />
          <span style={{ flex: 1 }}>{placeholder}</span>
          <kbd
            style={{
              fontFamily: 'SF Mono, Menlo, monospace',
              fontSize: 11,
              background: 'var(--panel)',
              color: 'var(--muted)',
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            ⌘ K
          </kbd>
        </button>

        <div
          role="list"
          aria-label="AI 快速建議"
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          {quickChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="listitem"
              onClick={() => submit(chip.intent ?? chip.label, 'chip')}
              style={{
                padding: '7px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 13,
                color: 'var(--text)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.18s',
                font: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ai)';
                e.currentTarget.style.color = 'var(--ai)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text)';
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--ai)',
                }}
              />
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Full-screen overlay */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI Command"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            background: 'rgba(15, 16, 30, 0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: '12vh',
            animation: 'aiSlotEnter 200ms var(--ai-ease-out)',
          }}
        >
          <div
            style={{
              width: 'min(720px, 92vw)',
              background: 'var(--surface)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(value, 'type');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '18px 22px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--ai-gradient)',
                  flexShrink: 0,
                  animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
                }}
              />
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                aria-label="向 AI 提問"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 18,
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                }}
              />
              <kbd
                style={{
                  fontFamily: 'SF Mono, monospace',
                  fontSize: 11,
                  background: 'var(--panel)',
                  color: 'var(--muted)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                Esc 關閉
              </kbd>
            </form>

            <div style={{ padding: '14px 22px 18px' }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                試試
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {quickChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => submit(chip.intent ?? chip.label, 'chip')}
                    style={{
                      padding: '10px 12px',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 14,
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      font: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--ai-soft)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span aria-hidden>✨</span>
                    {chip.label}
                  </button>
                ))}
              </div>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: '1px dashed var(--border)',
                  fontSize: 11,
                  color: 'var(--muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>AI 不會自動執行；危險操作會二次確認</span>
                <Link href="/me/privacy" style={{ color: 'var(--ai)', textDecoration: 'none' }}>
                  AI 資料政策 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
