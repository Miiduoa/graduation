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
    const baseStyles: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      borderRadius: "12px",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      fontWeight: 600,
      fontSize: size === "sm" ? "13px" : size === "lg" ? "15px" : "14px",
      transition: "all 0.2s ease",
      letterSpacing: "0.1px",
      opacity: disabled || loading ? 0.6 : 1,
      width: fullWidth ? "100%" : "auto",
      border: "1px solid var(--border)",
      ...style,
    };

    const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
      sm: { padding: "8px 14px", minHeight: "36px" },
      md: { padding: "12px 20px", minHeight: "44px" },
      lg: { padding: "14px 24px", minHeight: "52px" },
    };

    const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
      default: {
        background: "var(--panel)",
        color: "var(--text)",
        borderColor: "var(--border)",
      },
      primary: {
        background: "var(--brand)",
        color: "#fff",
        borderColor: "var(--brand)",
      },
      success: {
        background: "rgba(16, 185, 129, 0.2)",
        color: "#10B981",
        borderColor: "rgba(16, 185, 129, 0.4)",
      },
      danger: {
        background: "rgba(239, 68, 68, 0.2)",
        color: "#EF4444",
        borderColor: "rgba(239, 68, 68, 0.4)",
      },
      ghost: {
        background: "transparent",
        color: "var(--text)",
        borderColor: "transparent",
      },
      outline: {
        background: "transparent",
        color: "var(--brand)",
        borderColor: "var(--brand)",
      },
    };

    const combinedStyles: React.CSSProperties = {
      ...baseStyles,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={className}
        style={combinedStyles}
        {...props}
      >
        {loading ? (
          <>
            <LoadingSpinner size={size === "sm" ? 14 : size === "lg" ? 20 : 16} />
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

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite" }}
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
        opacity="0.25"
      />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="31.4 31.4"
        strokeDashoffset="62.8"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

export { Button, LoadingSpinner };
export type { ButtonProps, ButtonVariant, ButtonSize };
