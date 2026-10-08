'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import MapCanvas from './MapCanvas';
import {
  loadMapFavorites,
  loadMapLocations,
  setMapFavorite,
  walkingDirectionsUrl,
  type MapLocation,
} from './mapService';
import styles from './map.module.css';

type MapProps = { school: string; route?: string; focus?: string };
type FavoritesState = { status: 'loading' | 'error' | 'ready'; ids: Set<string> };

export default function MapClient(props: MapProps) {
  const { user, loading, error } = useAuth();
  return (
    <MapContent
      key={JSON.stringify([
        props.school,
        props.route,
        props.focus,
        user?.uid,
        loading,
        Boolean(error),
      ])}
      {...props}
      uid={!loading && !error ? user?.uid : undefined}
      authLoading={loading}
    />
  );
}

function MapContent({
  school,
  route,
  focus,
  uid,
  authLoading,
}: MapProps & {
  uid?: string;
  authLoading: boolean;
}) {
  const [placeState, setPlaceState] = useState<{
    status: 'loading' | 'error' | 'ready';
    locations: MapLocation[];
  }>({ status: 'loading', locations: [] });
  const [placeAttempt, setPlaceAttempt] = useState(0);
  const { locations } = placeState;
  const loading = placeState.status === 'loading';
  const error = placeState.status === 'error';
  function retry() {
    setPlaceState({ status: 'loading', locations: [] });
    setPlaceAttempt((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    void loadMapLocations(school).then(
      (locations) => {
        if (active) setPlaceState({ status: 'ready', locations });
      },
      () => {
        if (active) setPlaceState({ status: 'error', locations: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [school, placeAttempt]);
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoritesState>({ status: 'loading', ids: new Set() });
  const [favoriteAttempt, setFavoriteAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const writing = useRef(false);
  const favoriteGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      favoriteGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    const generation = ++favoriteGeneration.current;
    void loadMapFavorites(uid, school).then(
      (ids) => {
        if (mounted.current && generation === favoriteGeneration.current)
          setFavorites({ status: 'ready', ids: new Set(ids) });
      },
      () => {
        if (mounted.current && generation === favoriteGeneration.current)
          setFavorites({ status: 'error', ids: new Set() });
      },
    );
  }, [uid, school, favoriteAttempt]);

  const categories = useMemo(
    () => ['全部', ...new Set(locations.map((location) => location.category))],
    [locations],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('zh-TW');
    return locations.filter(
      (location) =>
        (category === '全部' || location.category === category) &&
        `${location.name} ${location.description}`.toLocaleLowerCase('zh-TW').includes(term),
    );
  }, [locations, category, search]);
  const selected = locations.find((location) => location.id === (selection ?? focus)) ?? null;
  const routeLocations = useMemo<[MapLocation, MapLocation] | null>(() => {
    const ids = route?.split(',').map((id) => id.trim());
    if (!ids || ids.length !== 2 || ids[0] === ids[1]) return null;
    const from = locations.find((location) => location.id === ids[0]);
    const to = locations.find((location) => location.id === ids[1]);
    return from && to ? [from, to] : null;
  }, [route, locations]);
  const selectLocation = useCallback((location: MapLocation) => setSelection(location.id), []);
  const mapLocations = useMemo(() => {
    const visible = new Map(filtered.map((location) => [location.id, location]));
    for (const location of [...(routeLocations ?? []), ...(selected ? [selected] : [])])
      visible.set(location.id, location);
    return [...visible.values()];
  }, [filtered, selected, routeLocations]);

  async function toggleFavorite(location: MapLocation) {
    if (!uid || favorites.status !== 'ready' || writing.current) return;
    writing.current = true;
    setPending(location.id);
    setNotice('');
    const saved = !favorites.ids.has(location.id);
    try {
      await setMapFavorite(uid, school, location, saved, () => mounted.current);
      if (!mounted.current) return;
      setFavorites((previous) => {
        const ids = new Set(previous.ids);
        if (saved) ids.add(location.id);
        else ids.delete(location.id);
        return { status: 'ready', ids };
      });
      setNotice(saved ? `已收藏「${location.name}」` : `已取消收藏「${location.name}」`);
    } catch {
      if (!mounted.current) return;
      // A lost response is not proof that the write failed. Reload before another change.
      setFavorites({ status: 'error', ids: new Set() });
      setNotice('無法確認收藏結果，請重新讀取收藏後再試。');
    } finally {
      writing.current = false;
      if (mounted.current) setPending(null);
    }
  }

  if (loading)
    return (
      <div className="card" role="status">
        正在載入校園地點…
      </div>
    );
  if (error)
    return (
      <div className={`card ${styles.state}`} role="alert">
        <h2>暫時無法取得校園地點</h2>
        <p>請稍後重新載入。確認地點資料後，就能搜尋設施與開啟導航。</p>
        <button className="btn" onClick={retry}>
          重新載入地點
        </button>
      </div>
    );
  if (!locations.length)
    return (
      <div className={`card ${styles.state}`}>
        <h2>目前沒有可顯示的校園地點</h2>
        <p>地點需要有完整的名稱與座標才能顯示。你也可以先查詢校方提供的校園資訊。</p>
        <a className="btn" href="https://www.pu.edu.tw/" target="_blank" rel="noopener noreferrer">
          開啟靜宜大學網站
        </a>
      </div>
    );

  return (
    <div className={`pageStack ${styles.page}`}>
      {route && !routeLocations && (
        <p className={styles.notice} role="status">
          這個連結的起點或終點已不在目前地點資料中，請從下方列表重新選擇。
        </p>
      )}
      {focus && !locations.some((location) => location.id === focus) && (
        <p className={styles.notice} role="status">
          找不到連結指定的地點，請搜尋地點名稱。
        </p>
      )}
      {routeLocations && (
        <section className={`card ${styles.route}`} aria-label="步行導航">
          <div>
            <p className={styles.eyebrow}>前往目的地</p>
            <h2>
              {routeLocations[0].name} → {routeLocations[1].name}
            </h2>
            <p>開啟 Google 地圖查詢可通行的步行路線與時間。</p>
          </div>
          <a
            className="btn primary"
            href={walkingDirectionsUrl(routeLocations[1], routeLocations[0])}
            target="_blank"
            rel="noopener noreferrer"
          >
            開啟步行導航
          </a>
        </section>
      )}
      <div className={styles.toolbar}>
        <label className={styles.search}>
          搜尋地點
          <input
            className="input"
            type="search"
            placeholder="輸入建築、設施或關鍵字"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className={styles.categories} aria-label="地點分類">
          {categories.map((value) => (
            <button
              key={value}
              className={category === value ? styles.active : ''}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <MapCanvas
        locations={mapLocations}
        selected={selected}
        route={routeLocations}
        onSelect={selectLocation}
      />
      {selected && (
        <section className={`card ${styles.detail}`} aria-label="地點詳情">
          <div>
            <p className={styles.eyebrow}>{selected.category}</p>
            <h2>{selected.name}</h2>
            {selected.description && <p>{selected.description}</p>}
            <a
              className="btn"
              href={walkingDirectionsUrl(selected)}
              target="_blank"
              rel="noopener noreferrer"
            >
              從目前位置導航
            </a>
          </div>
          <button
            className={styles.close}
            aria-label="關閉地點詳情"
            onClick={() => setSelection('')}
          >
            ×
          </button>
        </section>
      )}
      <section className={styles.directory} aria-label="地點列表">
        <div className={styles.listHeader}>
          <h2>
            地點列表 <span>{filtered.length} 個</span>
          </h2>
          {!uid && !authLoading && (
            <Link href={`/login?returnUrl=${encodeURIComponent(`/map?schoolId=${school}`)}`}>
              登入後可收藏地點
            </Link>
          )}
        </div>
        {uid && favorites.status === 'loading' && (
          <p role="status" className={styles.note}>
            正在讀取收藏…
          </p>
        )}
        {uid && favorites.status === 'error' && (
          <div className={styles.notice} role="alert">
            <p>收藏狀態目前無法確認。</p>
            <button
              className="btn"
              disabled={Boolean(pending)}
              onClick={() => {
                setNotice('');
                setFavorites({ status: 'loading', ids: new Set() });
                setFavoriteAttempt((value) => value + 1);
              }}
            >
              重新讀取收藏
            </button>
          </div>
        )}
        {notice && (
          <p className={styles.note} role="status">
            {notice}
          </p>
        )}
        {!filtered.length ? (
          <div className={styles.empty}>
            <p>沒有符合條件的地點。</p>
            <button
              className="btn"
              onClick={() => {
                setSearch('');
                setCategory('全部');
              }}
            >
              清除搜尋條件
            </button>
          </div>
        ) : (
          <ul className={styles.list}>
            {filtered.map((location) => (
              <li
                key={location.id}
                className={selected?.id === location.id ? styles.selected : undefined}
              >
                <button
                  className={styles.location}
                  aria-label={`查看${location.name}`}
                  aria-pressed={selected?.id === location.id}
                  onClick={() => selectLocation(location)}
                >
                  <span className={styles.locationName}>{location.name}</span>
                  <span className={styles.note}>{location.category}</span>
                  {location.description && (
                    <span className={styles.description}>{location.description}</span>
                  )}
                </button>
                {uid && (
                  <button
                    className={styles.favorite}
                    aria-label={`${favorites.ids.has(location.id) ? '取消收藏' : '收藏'}${location.name}`}
                    aria-pressed={favorites.ids.has(location.id)}
                    disabled={favorites.status !== 'ready' || Boolean(pending)}
                    onClick={() => void toggleFavorite(location)}
                  >
                    {pending === location.id
                      ? '儲存中…'
                      : favorites.ids.has(location.id)
                        ? '已收藏'
                        : '收藏'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
