'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { useLocationHash } from '@/lib/useLocationHash';
import MapCanvas from './MapCanvas';
import {
  loadMapFavorites,
  loadMapLocations,
  setMapFavorite,
  walkingDirectionsUrl,
  distanceMeters,
  formatDistance,
  type MapCoordinate,
  type MapLocation,
} from './mapService';
import styles from './map.module.css';
import {
  buildCampusMapSearchUrl,
  hasOfficialProvidenceLibraryGuide,
  PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL,
} from '@campus/shared/src/campusMapLookup';

type MapProps = { school: string; schoolName?: string; route?: string; focus?: string };
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
  schoolName,
  route,
  focus,
  uid,
  authLoading,
}: MapProps & {
  uid?: string;
  authLoading: boolean;
}) {
  const hash = useLocationHash();
  const fallbackMapUrl = buildCampusMapSearchUrl(schoolName);
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
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [myLocation, setMyLocation] = useState<MapCoordinate | null>(null);
  const [positionStatus, setPositionStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [positionError, setPositionError] = useState('');
  const [routeDraft, setRouteDraft] = useState<{ from: string | null; to: string | null } | null>(null);
  const [favorites, setFavorites] = useState<FavoritesState>({ status: 'loading', ids: new Set() });
  const [favoriteAttempt, setFavoriteAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const positionGeneration = useRef(0);
  const writing = useRef(false);
  const favoriteGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      favoriteGeneration.current += 1;
      positionGeneration.current += 1;
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
    const matched = locations.filter(
      (location) =>
        (category === '全部' || location.category === category) &&
        [
          location.name,
          location.category,
          location.description,
          location.building,
          location.floor,
          ...(location.facilities ?? []),
        ].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(term) &&
        (!onlyFavorites || favorites.status !== 'ready' || favorites.ids.has(location.id)) &&
        (!nearbyOnly || !myLocation || distanceMeters(myLocation, location) <= 1000),
    );
    if (myLocation)
      matched.sort((a, b) => distanceMeters(myLocation, a) - distanceMeters(myLocation, b));
    return matched;
  }, [locations, category, search, onlyFavorites, favorites, nearbyOnly, myLocation]);
  const selected = locations.find((location) => location.id === (selection ?? focus)) ?? null;
  const returnParams = new URLSearchParams({ schoolId: school });
  if (route) returnParams.set('route', route);
  if (selection ?? focus) returnParams.set('focus', (selection ?? focus)!);
  const schoolLoginHref = `/login?reconnect=school&returnUrl=${encodeURIComponent(`/map?${returnParams}${hash}`)}`;
  const deepLinkRoute = useMemo<[MapLocation, MapLocation] | null>(() => {
    const ids = route?.split(',').map((id) => id.trim());
    if (!ids || ids.length !== 2 || ids[0] === ids[1]) return null;
    const from = locations.find((location) => location.id === ids[0]);
    const to = locations.find((location) => location.id === ids[1]);
    return from && to ? [from, to] : null;
  }, [route, locations]);
  const routeLocations = useMemo<[MapLocation, MapLocation] | null>(() => {
    if (routeDraft === null) return deepLinkRoute;
    const from = locations.find((location) => location.id === routeDraft.from);
    const to = locations.find((location) => location.id === routeDraft.to);
    return from && to && from.id !== to.id ? [from, to] : null;
  }, [deepLinkRoute, routeDraft, locations]);
  const routeStart = routeDraft?.from
    ? locations.find((location) => location.id === routeDraft.from)
    : null;
  const selectLocation = useCallback((location: MapLocation) => setSelection(location.id), []);
  const mapLocations = useMemo(() => {
    const visible = new Map(filtered.map((location) => [location.id, location]));
    for (const location of [...(routeLocations ?? []), ...(selected ? [selected] : [])])
      visible.set(location.id, location);
    return [...visible.values()];
  }, [filtered, selected, routeLocations]);

  function locate() {
    const request = ++positionGeneration.current;
    setMyLocation(null);
    setPositionError('');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPositionStatus('error');
      setPositionError('此瀏覽器無法取得位置。你仍可從地點列表指定步行起點。');
      return;
    }
    setPositionStatus('loading');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mounted.current || request !== positionGeneration.current) return;
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
          setPositionStatus('error');
          setPositionError('定位結果無效，請重新取得位置。');
          return;
        }
        setMyLocation({ lat: coords.latitude, lng: coords.longitude });
        setPositionStatus('idle');
      },
      (positionError) => {
        if (!mounted.current || request !== positionGeneration.current) return;
        setPositionStatus('error');
        setPositionError(
          positionError.code === 1
            ? '未取得位置權限。你仍可從地點列表指定步行起點。'
            : '目前無法取得位置，請確認定位與網路後再試一次。',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

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
        {school === 'pu' ? (
          <a className="btn" href="https://www.pu.edu.tw/" target="_blank" rel="noopener noreferrer">
            開啟靜宜大學網站
          </a>
        ) : (
          <>
            <p>目前還沒有這所校園的地點資料，不會改用其他學校的建築或導航位置。</p>
            {fallbackMapUrl && (
              <>
                <a className="btn" href={fallbackMapUrl} target="_blank" rel="noopener noreferrer">
                  在 Google 地圖搜尋{schoolName} ↗
                </a>
                <p>此連結為第三方地圖搜尋，地點及路線仍需自行核對，不代表校方已發布建築座標。</p>
              </>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className={`pageStack ${styles.page}`}>
      {route && !deepLinkRoute && routeDraft === null && (
        <p className={styles.notice} role="status">
          這個連結的起點或終點已不在目前地點資料中，請從下方列表重新選擇。
        </p>
      )}
      {focus && !locations.some((location) => location.id === focus) && (
        <p className={styles.notice} role="status">
          找不到連結指定的地點，請搜尋地點名稱。
        </p>
      )}
      {routeStart && !routeLocations && (
        <p className={styles.notice} role="status">
          已設定「{routeStart.name}」為起點。請選擇其他地點，再按「設為終點」。
        </p>
      )}
      {routeLocations && (
        <section className={`card ${styles.route}`} aria-label="步行導航">
          <div>
            <p className={styles.eyebrow}>前往目的地</p>
            <h2>
              {routeLocations[0].name} → {routeLocations[1].name}
            </h2>
            <p>
              兩地直線距離約 {formatDistance(distanceMeters(routeLocations[0], routeLocations[1]))}；
              實際步行路線與時間以地圖服務為準。
            </p>
          </div>
          <div className={styles.actions}>
            <a
              className="btn primary"
              href={walkingDirectionsUrl(routeLocations[1], routeLocations[0])}
              target="_blank"
              rel="noopener noreferrer"
            >
              開啟步行導航
            </a>
            <button className="btn" onClick={() => setRouteDraft({ from: null, to: null })}>
              清除路線
            </button>
          </div>
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
        <div className={styles.tools}>
          <button className="btn" onClick={locate} disabled={positionStatus === 'loading'}>
            {positionStatus === 'loading' ? '正在定位…' : myLocation ? '更新我的位置' : '查看我的位置'}
          </button>
          <button
            className="btn"
            aria-pressed={nearbyOnly}
            disabled={!myLocation}
            onClick={() => setNearbyOnly((value) => !value)}
          >
            附近 1 公里
          </button>
          {uid && (
            <button
              className="btn"
              aria-pressed={onlyFavorites}
              disabled={favorites.status !== 'ready'}
              onClick={() => setOnlyFavorites((value) => !value)}
            >
              只看收藏
            </button>
          )}
        </div>
        {positionError && <p className={styles.notice} role="alert">{positionError}</p>}
        {myLocation && (
          <p className={styles.note} role="status">
            已定位，地點依直線距離由近到遠排序；校園步道與路口請以實際路線為準。
          </p>
        )}
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
        myLocation={myLocation}
        onSelect={selectLocation}
      />
      {selected && (
        <section className={`card ${styles.detail}`} aria-label="地點詳情">
          <div>
            <p className={styles.eyebrow}>{selected.category}</p>
            <h2>{selected.name}</h2>
            {selected.description && <p>{selected.description}</p>}
            {(selected.building || selected.floor) && (
              <p>{[selected.building, selected.floor && `樓層：${selected.floor}`].filter(Boolean).join(' · ')}</p>
            )}
            {Boolean(selected.facilities?.length) && (
              <p>提供設施：{selected.facilities!.join('、')}</p>
            )}
            {myLocation && (
              <p>距離我的位置約 {formatDistance(distanceMeters(myLocation, selected))}（直線距離）</p>
            )}
            <div className={styles.actions}>
              <a
                className="btn"
                href={walkingDirectionsUrl(selected, myLocation ?? undefined)}
                target="_blank"
                rel="noopener noreferrer"
              >
                從目前位置導航
              </a>
              {hasOfficialProvidenceLibraryGuide(school, selected) && (
                <a
                  className="btn"
                  href={PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看校方樓層導覽
                </a>
              )}
              <button
                className="btn"
                onClick={() => {
                  setRouteDraft({ from: selected.id, to: null });
                  setNotice('');
                }}
              >
                設為起點
              </button>
              {routeStart && routeStart.id !== selected.id && (
                <button
                  className="btn"
                  onClick={() => {
                    setRouteDraft({ from: routeStart.id, to: selected.id });
                    setNotice('');
                  }}
                >
                  設為終點
                </button>
              )}
            </div>
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
          {!uid && !authLoading && <Link href={schoolLoginHref}>連線學校帳號以收藏</Link>}
        </div>
        {!uid && !authLoading && (
          <p className={styles.note}>地圖與導航不需登入；收藏尚未支援 Google 帳號。</p>
        )}
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
                setNearbyOnly(false);
                setOnlyFavorites(false);
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
                  <span className={styles.note}>
                    {[location.category, location.building, location.floor && `樓層：${location.floor}`].filter(Boolean).join(' · ')}
                    {myLocation && ` · 直線距離 ${formatDistance(distanceMeters(myLocation, location))}`}
                  </span>
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
