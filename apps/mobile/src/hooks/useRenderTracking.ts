/* eslint-disable */
import { useRef, useEffect, useCallback } from "react";

export type RenderTrackingOptions = {
  name: string;
  enabled?: boolean;
  warnThreshold?: number;
};

export type RenderStats = {
  renderCount: number;
  lastRenderTime: number;
  averageRenderTime: number;
  totalRenderTime: number;
  warnCount: number;
};

const globalStats = new Map<string, RenderStats>();

export function useRenderTracking(options: RenderTrackingOptions) {
  const { name, enabled = __DEV__, warnThreshold = 16 } = options;
  
  const renderCountRef = useRef(0);
  const lastRenderStartRef = useRef(0);
  const totalRenderTimeRef = useRef(0);
  const warnCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    
    renderCountRef.current++;
    const startTime = performance.now();
    lastRenderStartRef.current = startTime;

    return () => {
      const endTime = performance.now();
      const renderTime = endTime - startTime;
      totalRenderTimeRef.current += renderTime;

      if (renderTime > warnThreshold) {
        warnCountRef.current++;
        console.warn(
          `[RenderTracking] ${name} 渲染耗時 ${renderTime.toFixed(2)}ms，超過閾值 ${warnThreshold}ms`
        );
      }

      const stats: RenderStats = {
        renderCount: renderCountRef.current,
        lastRenderTime: renderTime,
        averageRenderTime: totalRenderTimeRef.current / renderCountRef.current,
        totalRenderTime: totalRenderTimeRef.current,
        warnCount: warnCountRef.current,
      };

      globalStats.set(name, stats);
    };
  });

  const getStats = useCallback((): RenderStats | null => {
    return globalStats.get(name) ?? null;
  }, [name]);

  return { getStats };
}

export function useWhyDidYouRender<T extends Record<string, any>>(
  name: string,
  props: T,
  enabled: boolean = __DEV__
) {
  const prevPropsRef = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (prevPropsRef.current) {
      const changedProps: string[] = [];
      const allKeys = new Set([
        ...Object.keys(prevPropsRef.current),
        ...Object.keys(props),
      ]);

      allKeys.forEach((key) => {
        if (prevPropsRef.current![key] !== props[key]) {
          changedProps.push(key);
        }
      });

      if (changedProps.length > 0) {
        console.log(`[WhyDidYouRender] ${name} 因以下 props 變化而重新渲染:`, changedProps);
        changedProps.forEach((key) => {
          console.log(`  - ${key}:`, {
            from: prevPropsRef.current![key],
            to: props[key],
          });
        });
      }
    }

    prevPropsRef.current = { ...props };
  }, [name, props, enabled]);
}

export function useMemoryTracking(enabled: boolean = __DEV__) {
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (typeof performance !== "undefined" && "memory" in performance) {
        const memory = (performance as any).memory;
        if (memory) {
          const used = (memory.usedJSHeapSize / 1048576).toFixed(2);
          const total = (memory.totalJSHeapSize / 1048576).toFixed(2);
          console.log(`[Memory] 已使用: ${used}MB / 總計: ${total}MB`);
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [enabled]);
}

export function getAllRenderStats(): Map<string, RenderStats> {
  return new Map(globalStats);
}

export function clearRenderStats(): void {
  globalStats.clear();
}

export function printRenderStatsReport(): void {
  console.log("=== 渲染效能報告 ===");
  
  const sortedStats = Array.from(globalStats.entries()).sort(
    (a, b) => b[1].totalRenderTime - a[1].totalRenderTime
  );

  sortedStats.forEach(([name, stats]) => {
    console.log(`
組件: ${name}
  渲染次數: ${stats.renderCount}
  平均耗時: ${stats.averageRenderTime.toFixed(2)}ms
  總耗時: ${stats.totalRenderTime.toFixed(2)}ms
  超時警告: ${stats.warnCount}次
    `);
  });
}
