"use client";

import { ReactNode } from "react";
import { Button } from "./Button";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "primary";
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  size?: "sm" | "md" | "lg";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = "md",
}: EmptyStateProps) {
  const sizeStyles = {
    sm: { iconSize: "40px", titleSize: "16px", descSize: "13px", padding: "24px" },
    md: { iconSize: "56px", titleSize: "18px", descSize: "14px", padding: "40px" },
    lg: { iconSize: "72px", titleSize: "22px", descSize: "15px", padding: "56px" },
  };

  const styles = sizeStyles[size];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: styles.padding,
      }}
    >
      {icon && (
        <div
          style={{
            width: styles.iconSize,
            height: styles.iconSize,
            borderRadius: "16px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `calc(${styles.iconSize} * 0.5)`,
            marginBottom: "20px",
          }}
        >
          {icon}
        </div>
      )}
      <h3
        style={{
          margin: 0,
          fontSize: styles.titleSize,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: styles.descSize,
            color: "var(--muted)",
            lineHeight: 1.6,
            maxWidth: "320px",
          }}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div
          style={{
            marginTop: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          {action && (
            <Button
              variant={action.variant ?? "primary"}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = "發生錯誤",
  message = "無法載入資料，請稍後再試",
  onRetry,
  retryLabel = "重試",
}: ErrorStateProps) {
  return (
    <EmptyState
      icon="❌"
      title={title}
      description={message}
      action={onRetry ? { label: retryLabel, onClick: onRetry, variant: "primary" } : undefined}
    />
  );
}

interface NoDataStateProps {
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function NoDataState({
  title = "沒有資料",
  message = "目前沒有任何資料",
  action,
}: NoDataStateProps) {
  return (
    <EmptyState
      icon="📭"
      title={title}
      description={message}
      action={action ? { ...action, variant: "primary" } : undefined}
    />
  );
}

interface NoSearchResultsProps {
  query: string;
  onClear?: () => void;
}

export function NoSearchResults({ query, onClear }: NoSearchResultsProps) {
  return (
    <EmptyState
      icon="🔍"
      title="找不到結果"
      description={`沒有符合「${query}」的搜尋結果`}
      action={onClear ? { label: "清除搜尋", onClick: onClear } : undefined}
    />
  );
}

export type { EmptyStateProps, ErrorStateProps, NoDataStateProps, NoSearchResultsProps };
