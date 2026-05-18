'use client';

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'default' | 'primary' | 'success' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      disabled,
      className = '',
      children,
      style,
      ...props
    },
    ref,
  ) => {
    // Apple HIG: 觸控目標 ≥44pt，緊湊型 34pt，超大型 52pt
    const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
      sm: { padding: '0 14px', minHeight: '34px', fontSize: '14px' },
      md: { padding: '0 18px', minHeight: '44px', fontSize: '15px' },
      lg: { padding: '0 24px', minHeight: '52px', fontSize: '17px' },
    };

    const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
      // iOS Bordered / Gray Tint — 第二序按鈕
      default: {
        background: 'var(--surface)',
        color: 'var(--text)',
        borderColor: 'var(--border)',
        boxShadow: 'none',
      },
      // iOS Filled — 主要動作
      primary: {
        background: 'var(--brand)',
        color: '#fff',
        borderColor: 'transparent',
        boxShadow: 'none',
      },
      // iOS Tinted — 成功 / 安全動作
      success: {
        background: 'var(--success-soft)',
        color: 'var(--success)',
        borderColor: 'transparent',
        boxShadow: 'none',
      },
      // iOS Tinted Destructive — 刪除類動作
      danger: {
        background: 'var(--danger-soft)',
        color: 'var(--danger)',
        borderColor: 'transparent',
        boxShadow: 'none',
      },
      // iOS Plain — 純文字按鈕
      ghost: {
        background: 'transparent',
        color: 'var(--brand)',
        borderColor: 'transparent',
        boxShadow: 'none',
      },
      // iOS Bordered Tinted — 次要動作（描邊）
      outline: {
        background: 'transparent',
        color: 'var(--brand)',
        borderColor: 'var(--brand)',
        boxShadow: 'none',
      },
    };

    // iOS button radius：10–12pt 視按鈕高度而定；以 radius-sm（12px）為基準
    const baseStyles: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid',
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      transition: 'opacity 0.15s ease, transform 0.1s ease, background 0.15s ease',
      opacity: disabled || loading ? 0.4 : 1,
      width: fullWidth ? '100%' : 'auto',
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`btn${className ? ` ${className}` : ''}`}
        style={baseStyles}
        {...props}
      >
        {loading ? (
          <>
            <LoadingSpinner size={size === 'sm' ? 13 : size === 'lg' ? 18 : 15} />
            {children && <span>{children}</span>}
          </>
        ) : (
          <>
            {icon && iconPosition === 'left' && icon}
            {children}
            {icon && iconPosition === 'right' && icon}
          </>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';

function LoadingSpinner({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="31.4 31.4"
        opacity="0.2"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Button, LoadingSpinner };
export type { ButtonProps, ButtonVariant, ButtonSize };
