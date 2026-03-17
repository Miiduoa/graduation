"use client";

import { HTMLAttributes, ReactNode, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined" | "filled";
  padding?: "none" | "sm" | "md" | "lg";
  hoverable?: boolean;
  clickable?: boolean;
  children: ReactNode;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = "default",
      padding = "md",
      hoverable = true,
      clickable = false,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const paddingMap = {
      none: "0",
      sm: "12px",
      md: "20px",
      lg: "28px",
    };

    const variantStyles: Record<string, React.CSSProperties> = {
      default: {
        border: "1px solid var(--border)",
        background: "var(--panel)",
      },
      elevated: {
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
      },
      outlined: {
        border: "2px solid var(--border)",
        background: "transparent",
      },
      filled: {
        border: "none",
        background: "var(--panel2)",
      },
    };

    const baseStyles: React.CSSProperties = {
      borderRadius: "var(--radius-lg)",
      padding: paddingMap[padding],
      transition: "all 0.2s ease",
      cursor: clickable ? "pointer" : "default",
      ...variantStyles[variant],
      ...style,
    };

    return (
      <div
        ref={ref}
        style={baseStyles}
        className={hoverable ? "card" : ""}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

function CardHeader({ title, subtitle, action, icon }: CardHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {icon && (
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
            }}
          >
            {icon}
          </div>
        )}
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "13px",
                color: "var(--muted)",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function CardContent({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={style}>{children}</div>;
}

function CardFooter({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        marginTop: "16px",
        paddingTop: "16px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "12px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export { Card, CardHeader, CardContent, CardFooter };
export type { CardProps, CardHeaderProps };
