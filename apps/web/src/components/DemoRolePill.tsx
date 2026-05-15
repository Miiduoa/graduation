'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  DEMO_ROLES,
  getDemoRoleDefinition,
  useDemoRole,
  type DemoRole,
} from '@/lib/demoRole';
import { getDemoUser } from '@/lib/demoData';

/**
 * 永遠顯示「目前以 X 身份瀏覽」的膠囊，點開可切換身份。
 * 用 client-only 渲染避免 SSR mismatch。
 */
export function DemoRolePill() {
  const [role, setRole] = useDemoRole();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 點外面關閉
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  if (!mounted) {
    // SSR / pre-hydration 不顯示，避免閃爍
    return null;
  }

  const def = getDemoRoleDefinition(role);
  const user = def.demoUserUid ? getDemoUser(def.role === 'guest' ? 'student' : def.role) : null;

  const handleSwitch = (nextRole: DemoRole) => {
    setRole(nextRole);
    setOpen(false);
    const target = getDemoRoleDefinition(nextRole).entryHref;
    const school = searchParams.get('school') || '';
    const schoolId = searchParams.get('schoolId') || '';
    const q = school
      ? `?school=${encodeURIComponent(school)}&schoolId=${encodeURIComponent(schoolId)}`
      : '';
    // 若已經在目標頁就不重新導，避免重新整理
    if (pathname !== target) {
      router.push(`${target}${q}`);
    }
  };

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 999,
    background: def.toneSoft,
    border: `1px solid ${def.tone}40`,
    color: def.tone,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'transform 0.1s ease',
    lineHeight: 1.4,
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={pillStyle}
        title="切換 demo 身份"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span aria-hidden style={{ fontSize: 14 }}>
          {def.icon}
        </span>
        <span>{def.shortLabel}</span>
        {user && (
          <span style={{ opacity: 0.7, fontWeight: 500 }}>· {user.displayName}</span>
        )}
        <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 280,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #e5e5e7)',
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            padding: 8,
            zIndex: 50,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--muted, #6b7280)',
              fontWeight: 700,
              padding: '8px 10px 6px',
            }}
          >
            切換 demo 身份
          </div>
          {DEMO_ROLES.map((r) => {
            const isActive = r.role === role;
            const u = r.demoUserUid ? getDemoUser(r.role === 'guest' ? 'student' : r.role) : null;
            return (
              <button
                key={r.role}
                type="button"
                role="menuitem"
                onClick={() => handleSwitch(r.role)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 10px',
                  border: 'none',
                  background: isActive ? r.toneSoft : 'transparent',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: 2,
                  color: 'var(--text, #111)',
                  transition: 'background 0.1s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel, #f4f4f5)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: r.toneSoft,
                    color: r.tone,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 16,
                  }}
                >
                  {r.icon}
                </span>
                <span style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {r.label}
                    {u && (
                      <span style={{ marginLeft: 6, color: 'var(--muted, #6b7280)', fontWeight: 500 }}>
                        · {u.displayName}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted, #6b7280)', lineHeight: 1.4 }}>
                    {r.description}
                  </span>
                </span>
                {isActive ? (
                  <span style={{ color: r.tone, fontSize: 14, fontWeight: 800 }}>✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
