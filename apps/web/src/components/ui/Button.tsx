'use client';

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

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
    return (
      <button
        {...props}
        ref={ref}
        aria-busy={loading || props['aria-busy']}
        disabled={disabled || loading}
        className={[
          'btn',
          styles.button,
          styles[variant],
          styles[size],
          loading ? styles.loading : '',
          fullWidth ? styles.fullWidth : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={style}
      >
        {icon && iconPosition === 'left' && icon}
        {children}
        {icon && iconPosition === 'right' && icon}
        {loading && <span className={styles.activity} aria-hidden="true" />}
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
      className={styles.spinner}
      aria-hidden="true"
      focusable="false"
    >
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
