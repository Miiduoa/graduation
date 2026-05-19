/**
 * recharts shim — 給 LMS v2 admin push-logs / reports 頁用
 * ──────────────────────────────────────────────
 * 畢業專題沒安裝 recharts。提供一個 minimal 兼容介面,
 * 用 inline SVG 畫簡易折線/長條圖,避免 build 失敗。
 *
 * 後續若要視覺化真的好,可:
 *   npm i recharts -w apps/web
 * 然後刪掉此 shim、把 import 換回 'recharts'。
 */
'use client';

import React from 'react';

export interface DataPoint {
  [key: string]: any;
}

export const ResponsiveContainer: React.FC<{
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
}> = ({ width = '100%', height = 240, children }) => (
  <div style={{ width, height, position: 'relative' }}>{children}</div>
);

export const LineChart: React.FC<any> = (props: any) => {
  const data: any[] = props.data ?? [];
  const children = props.children;
  const keys = data.length > 0 ? Object.keys(data[0]).filter(k => typeof data[0][k] === 'number') : [];
  const yKey = keys[0];
  const w = 600;
  const h = 200;
  const pad = 30;
  if (!yKey || data.length === 0) {
    return (
      <div style={{ padding: 24, color: '#AEAEB2', textAlign: 'center' }}>
        無資料 — recharts shim
      </div>
    );
  }
  const ys: number[] = data.map((d: any) => Number(d[yKey] ?? 0));
  const maxY = Math.max(...ys, 1);
  const stepX = (w - 2 * pad) / Math.max(data.length - 1, 1);
  const pts = ys.map((y: number, i: number) => `${pad + i * stepX},${h - pad - (y / maxY) * (h - 2 * pad)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%' }}>
      <polyline fill="none" stroke="#5856D6" strokeWidth="2" points={pts} />
      {children}
    </svg>
  );
};

export const BarChart: React.FC<any> = (props: any) => {
  const data: any[] = props.data ?? [];
  const children = props.children;
  const keys = data.length > 0 ? Object.keys(data[0]).filter(k => typeof data[0][k] === 'number') : [];
  const yKey = keys[0];
  const w = 600;
  const h = 200;
  const pad = 30;
  if (!yKey || data.length === 0) return <div style={{ padding: 24, color: '#AEAEB2' }}>無資料</div>;
  const ys: number[] = data.map((d: any) => Number(d[yKey] ?? 0));
  const maxY = Math.max(...ys, 1);
  const barW = (w - 2 * pad) / data.length - 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%' }}>
      {ys.map((y: number, i: number) => {
        const barH = (y / maxY) * (h - 2 * pad);
        return (
          <rect
            key={i}
            x={pad + i * (barW + 4)}
            y={h - pad - barH}
            width={barW}
            height={barH}
            fill="#5856D6"
          />
        );
      })}
      {children}
    </svg>
  );
};

// 空殼 — 維持 recharts API 形狀
const passthrough: React.FC<any> = ({ children }) => <>{children ?? null}</>;
export const Line = passthrough;
export const Bar = passthrough;
export const XAxis = passthrough;
export const YAxis = passthrough;
export const CartesianGrid = passthrough;
export const Tooltip = passthrough;
export const Legend = passthrough;
export const PieChart = passthrough;
export const Pie = passthrough;
export const Cell = passthrough;
