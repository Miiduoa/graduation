"use client";

import { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "success" | "danger" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      loading = false,
      icon,
      iconPosition = "left",
      fullWidth = false,
      disabled,
      className = "",
      children,
      style,
      ...props
    },
    ref
  ) => {
    const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
      sm: { padding: "0 12px", minHeight: "34px", fontSize: "13px" },
      md: { padding: "0 18px", minHeight: "44px", fontSize: "14px" },
      lg: { padding: "0 24px", minHeight: "52px", fontSize: "15px" },
    };

    const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
      default: {
        background: "var(--surface)",
        color: "var(--text)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-sm)",
      },
      primary: {
        background: "var(--brand)",
        color: "#fff",
        borderColor: "rgba(94, 106, 210, 0.3)",
        boxShadow: "4px 4px 10px rgba(94,106,210,0.30), -2px -2px 6px rgba(255,255,255,0.7)",
      },
      success: {
        background: "var(--success-soft)",
        color: "var(--success)",
        borderColor: "rgba(52,199,89,0.2)",
        boxShadow: "var(--shadow-sm)",
      },
      danger: {
        background: "var(--danger-soft)",
        color: "var(--danger)",
        borderColor: "rgba(255,59,48,0.2)",
        boxShadow: "var(--shadow-sm)",
      },
      ghost: {
        background: "transparent",
        color: "var(--text)",
        borderColor: "transparent",
        boxShadow: "none",
      },
      outline: {
        background: "transparent",
        color: "var(--brand)",
        borderColor: "rgba(94,106,210,0.4)",
        boxShadow: "none",
      },
    };

    const baseStyles: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "7px",
      borderRadius: "var(--radius-sm)",
      border: "1px solid",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      fontWeight: 600,
      letterSpacing: "-0.01em",
      transition: "box-shadow 0.2s ease, transform 0.15s ease, background 0.15s ease",
      opacity: disabled || loading ? 0.45 : 1,
      width: fullWidth ? "100%" : "auto",
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`btn${className ? ` ${className}` : ""}`}
        style={baseStyles}
        {...props}
      >
        {loading ? (
          <>
            <LoadingSpinner size={size === "sm" ? 13 : size === "lg" ? 18 : 15} />
            {children && <span>{children}</span>}
          </>
        ) : (
          <>
            {icon && iconPosition === "left" && icon}
            {children}
            {icon && iconPosition === "right" && icon}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

function LoadingSpinner({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
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
