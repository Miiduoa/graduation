"use client";

import { HTMLAttributes, ReactNode, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined" | "filled" | "inset" | "accent";
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
      sm: "14px",
      md: "20px",
      lg: "26px",
    };

    const variantStyles: Record<string, React.CSSProperties> = {
      default: {
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
      },
      elevated: {
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-md)",
      },
      outlined: {
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "none",
      },
      filled: {
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "none",
      },
      inset: {
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-inset)",
      },
      accent: {
        border: "1px solid rgba(94,106,210,0.18)",
        background: "var(--accent-soft)",
        boxShadow: "var(--shadow-sm)",
      },
    };

    const hoverStyle: React.CSSProperties =
      hoverable
        ? {
            transition: "box-shadow 0.2s ease, transform 0.2s ease",
          }
        : {};

    const baseStyles: React.CSSProperties = {
      borderRadius: "var(--radius-lg)",
      padding: paddingMap[padding],
      cursor: clickable ? "pointer" : "default",
      ...variantStyles[variant],
      ...hoverStyle,
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
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {icon && (
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              background: "var(--accent-soft)",
              border: "1px solid rgba(94,106,210,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              boxShadow: "var(--shadow-sm)",
              flexShrink: 0,
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
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              style={{
                margin: "3px 0 0",
                fontSize: "13px",
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
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
        paddingTop: "14px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "10px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export { Card, CardHeader, CardContent, CardFooter };
export type { CardProps, CardHeaderProps };
