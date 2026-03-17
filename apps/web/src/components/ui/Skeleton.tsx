"use client";

import { CSSProperties } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
  className?: string;
}

export function Skeleton({
  width = "100%",
  height = "20px",
  borderRadius = "8px",
  style,
  className,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className ?? ""}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function SkeletonText({
  lines = 3,
  width = "100%",
  lastLineWidth = "60%",
  gap = "12px",
}: {
  lines?: number;
  width?: string | number;
  lastLineWidth?: string | number;
  gap?: string | number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? lastLineWidth : width}
          height="14px"
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--panel)",
        borderRadius: "var(--radius-lg)",
        padding: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <Skeleton width="48px" height="48px" borderRadius="12px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height="16px" style={{ marginBottom: "8px" }} />
          <Skeleton width="40%" height="12px" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return <Skeleton width={size} height={size} borderRadius="50%" />;
}

export function SkeletonButton({ width = "100px" }: { width?: string | number }) {
  return <Skeleton width={width} height="44px" borderRadius="12px" />;
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "12px",
          padding: "12px",
          background: "var(--panel2)",
          borderRadius: "8px",
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width="80%" height="14px" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: "12px",
            padding: "12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} width={colIndex === 0 ? "90%" : "70%"} height="14px" />
          ))}
        </div>
      ))}
    </div>
  );
}

export type { SkeletonProps };
