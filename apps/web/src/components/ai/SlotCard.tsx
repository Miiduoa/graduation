'use client';

/**
 * Campus AI-First — SlotCard
 * --------------------------
 * AI 生成的卡片基底（Answer / Action / Compare / Schedule 四變體）
 *
 * 設計規範對應：docs/design/AI_FIRST_REDESIGN.md §4 Slot Card
 *  - 來源戳記 100% 覆蓋
 *  - 信心度永遠顯示
 *  - 可釘到 Today / 可展開為頁
 */

import { useMemo, type ReactNode } from 'react';

export type Confidence = 'high' | 'mid' | 'low';
export type SlotVariant = 'answer' | 'action' | 'compare' | 'schedule';

export type SlotCardProps = {
  variant: SlotVariant;
  title: string;
  icon?: string;
  confidence: Confidence;
  source: {
    name: string;
    timestamp?: Date | string;
    href?: string;
  };
  /** 點「展開」變一頁 */
  onExpand?: () => void;
  /** 點「釘到 Today」 */
  onPinToToday?: () => void;
  /** 額外動作按鈕 */
  actions?: ReactNode;
  children: ReactNode;
  /** 自訂 className，方便外層套版 */
  className?: string;
  /** 是否啟用 AI 漸層頂條（預設 true） */
  aiGenerated?: boolean;
};

const CONF_META: Record<
  Confidence,
  { color: string; bg: string; icon: string; label: string }
> = {
  high: {
    color: 'var(--confidence-high)',
    bg: 'var(--confidence-high-soft)',
    icon: '✓',
    label: '已驗證',
  },
  mid: {
    color: 'var(--confidence-mid)',
    bg: 'var(--confidence-mid-soft)',
    icon: '●',
    label: '中信心',
  },
  low: {
    color: 'var(--confidence-low)',
    bg: 'var(--confidence-low-soft)',
    icon: '⚠',
    label: '建議找真人',
  },
};

function formatTimestamp(ts?: Date | string): string {
  if (!ts) return '';
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function SlotCard({
  title,
  icon,
  confidence,
  source,
  onExpand,
  onPinToToday,
  actions,
  children,
  className,
  aiGenerated = true,
}: SlotCardProps) {
  const meta = CONF_META[confidence];
  const tsLabel = useMemo(() => formatTimestamp(source.timestamp), [source.timestamp]);

  return (
    <article
      className={className}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-lg)',
        transition: 'all 220ms var(--ai-ease-out)',
        animation: 'aiSlotEnter 220ms var(--ai-ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--ai)';
        e.currentTarget.style.boxShadow = 'var(--shadow-ai)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {aiGenerated && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: -1,
            left: -1,
            right: -1,
            height: 3,
            background: 'var(--ai-gradient)',
            borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          }}
        />
      )}

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}
      >
        {icon && (
          <div
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'var(--ai-soft)',
              color: 'var(--ai)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            flex: 1,
            color: 'var(--text)',
          }}
        >
          {title}
        </h3>
        {confidence !== 'high' && (
          <span
            style={{
              fontSize: 11,
              padding: '3px 9px',
              borderRadius: 'var(--radius-pill)',
              color: meta.color,
              background: meta.bg,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {meta.icon} {meta.label}
          </span>
        )}
      </header>

      <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.55 }}>{children}</div>

      {(actions || onExpand || onPinToToday) && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {actions}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              展開為一頁 ↗
            </button>
          )}
          {onPinToToday && (
            <button
              type="button"
              onClick={onPinToToday}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                font: 'inherit',
              }}
              title="把這張卡固定到 Today 主畫面"
            >
              📌 釘到 Today
            </button>
          )}
        </div>
      )}

      <footer
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--muted)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          📡 {source.name}
          {tsLabel && <span> · {tsLabel}</span>}
        </span>
        {confidence === 'high' && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              color: meta.color,
              background: meta.bg,
              fontWeight: 600,
            }}
          >
            {meta.icon} {meta.label}
          </span>
        )}
      </footer>
    </article>
  );
}
