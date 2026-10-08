'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  BUS_FRESHNESS_MS,
  TAICHUNG_BUS_URL,
  loadBusArrivals,
  loadBusRoutes,
  type BusArrivals,
  type CampusBusRoute,
} from '@/lib/bus';
import styles from '@/app/home.module.css';

function Arrivals({
  schoolId,
  stopId,
  stopName,
  city,
}: {
  schoolId: string;
  stopId: string;
  stopName: string;
  city: string;
}) {
  const [data, setData] = useState<BusArrivals | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const cancelRequests = useCallback(() => {
    generation.current += 1;
  }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const next = await loadBusArrivals({ schoolId, stopId, city });
    if (current !== generation.current) return;
    setData(next);
    setLoading(false);
  }, [schoolId, stopId, city]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelRequests();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, cancelRequests]);
  useEffect(() => {
    if (data?.status !== 'ready') return;
    const delay = Math.max(0, Date.parse(data.fetchedAt) + BUS_FRESHNESS_MS - Date.now());
    const timer = setTimeout(
      () => setData({ status: 'unavailable', arrivals: [], fetchedAt: null }),
      delay,
    );
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <section className={styles.section} aria-labelledby="arrival-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}>
        <h2 id="arrival-heading">{stopName} 到站資訊</h2>
        <button
          className={styles.secondary}
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
        >
          {loading ? '正在查詢…' : '更新到站資訊'}
        </button>
      </div>
      {loading && !data && (
        <p role="status" className={styles.empty}>
          正在向交通資料服務查詢。
        </p>
      )}
      {data?.status === 'error' && (
        <p role="alert" className={styles.notice}>
          無法連線取得到站資訊，請重新查詢或使用官方公車網站。
        </p>
      )}
      {data?.status === 'unavailable' && (
        <p role="status" className={styles.empty}>
          目前沒有可確認的即時到站資訊，請使用官方查詢確認班次。
        </p>
      )}
      {data?.status === 'ready' && (
        <>
          <p className={styles.sectionNote}>
            交通部 TDX 資料 · 取得於{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('zh-TW', {
              timeZone: 'Asia/Taipei',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
            。到站時間為預估，請留意現場車況。
          </p>
          {data.arrivals.length ? (
            <ul className={styles.list}>
              {data.arrivals.map((arrival, index) => (
                <li
                  className={styles.task}
                  key={`${arrival.routeName}:${arrival.direction}:${index}`}
                >
                  <div className={styles.taskContent}>
                    <strong>{arrival.routeName}</strong>
                    <span>{arrival.direction || stopName}</span>
                  </div>
                  <span className={styles.deadline}>{arrival.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>交通資料服務目前沒有提供這一站的到站預估。</p>
          )}
        </>
      )}
    </section>
  );
}

function SchoolBus({ schoolId }: { schoolId: string }) {
  const [routes, setRoutes] = useState<CampusBusRoute[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const generation = useRef(0);
  const cancelRequests = useCallback(() => {
    generation.current += 1;
  }, []);
  const refresh = useCallback(() => {
    const current = ++generation.current;
    return loadBusRoutes(schoolId)
      .then(
        (next) => {
          if (current === generation.current) {
            setRoutes(next);
            setFailed(false);
          }
        },
        () => {
          if (current === generation.current) {
            setRoutes(null);
            setFailed(true);
          }
        },
      )
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
  }, [schoolId]);
  useEffect(() => {
    void refresh();
    return () => {
      cancelRequests();
    };
  }, [refresh, cancelRequests]);
  const route = routes?.find((route) => route.id === routeId) ?? routes?.[0];
  const stop = route?.stops.find((stop) => stop.id === stopId) ?? route?.stops[0];
  return (
    <>
      <section className={styles.focus}>
        <p className={styles.focusLabel}>出發前確認班次</p>
        <h2>先選路線，再選候車站牌</h2>
        <p>查詢校園周邊已登錄的公車站點；尚未取得的班次會清楚標示。</p>
        <div className={styles.focusActions}>
          {schoolId === 'pu' && (
            <a
              className={styles.primary}
              href={TAICHUNG_BUS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              臺中市官方公車查詢 <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            className={styles.secondary}
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            {loading ? '讀取路線中…' : '重新讀取路線'}
          </button>
        </div>
      </section>
      {failed && (
        <p role="alert" className={styles.notice}>
          目前無法取得校園路線資料，請重新讀取或使用官方查詢。
        </p>
      )}
      {!loading && !failed && !routes?.length && (
        <div className={styles.empty}>
          <h2>目前沒有可查詢的校園站點</h2>
          <p>你仍可使用官方公車網站選擇路線與候車站牌。</p>
        </div>
      )}
      {route && stop && (
        <>
          <section className={styles.section} aria-label="選擇候車站點">
            <div className={styles.courses}>
              <label className={styles.course}>
                公車路線
                <select
                  value={route.id}
                  onChange={(event) => {
                    setRouteId(event.target.value);
                    setStopId('');
                  }}
                  style={{ display: 'block', width: '100%', padding: 12, marginTop: 8 }}
                >
                  {routes?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.course}>
                候車站牌
                <select
                  value={stop.id}
                  onChange={(event) => setStopId(event.target.value)}
                  style={{ display: 'block', width: '100%', padding: 12, marginTop: 8 }}
                >
                  {route.stops.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {route.description && <p className={styles.sectionNote}>{route.description}</p>}
          </section>
          <Arrivals
            key={`${schoolId}:${route.city}:${stop.id}`}
            schoolId={schoolId}
            city={route.city}
            stopId={stop.id}
            stopName={stop.name}
          />
        </>
      )}
    </>
  );
}

function BusContext() {
  const search = useSearchParams();
  const { schoolId, schoolName } = resolveSchoolPageContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
  });
  return (
    <SiteShell title="公車與交通" subtitle="查看候車站牌，確認到站資訊。" schoolName={schoolName}>
      <SchoolBus key={schoolId} schoolId={schoolId} />
    </SiteShell>
  );
}

export default function BusPage() {
  return (
    <Suspense
      fallback={
        <SiteShell title="公車與交通">
          <p role="status">讀取校園交通資料…</p>
        </SiteShell>
      }
    >
      <BusContext />
    </Suspense>
  );
}
