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
  hasBundledCampusPlaces,
  isBusStopLocation,
  isProvidencePendingVerification,
  locationMatchesSearch,
  PROVIDENCE_CAMPUS_SOURCE,
  PROVIDENCE_WALK_ORIGIN,
  providencePlaceSourceUrl,
  walkingEstimateLabel,
  withProvidenceCampusPlaces,
} from './providenceCampus';
import {
  buildCampusMapSearchUrl,
  getOfficialCampusMapUrl,
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
  const officialMapUrl = getOfficialCampusMapUrl(school);
  // 有內建地點的學校先直接顯示，外部來源只是補充；外部卡住或失敗都不擋住清單。
  const bundled = hasBundledCampusPlaces(school);
  const initialPlaces = () => ({
    status: bundled ? ('ready' as const) : ('loading' as const),
    source: 'loading' as const,
    locations: bundled ? withProvidenceCampusPlaces(school, []) : [],
  });
  const [placeState, setPlaceState] = useState<{
    status: 'loading' | 'error' | 'ready';
    source: 'loading' | 'error' | 'ready';
    locations: MapLocation[];
  }>(initialPlaces);
  const [placeAttempt, setPlaceAttempt] = useState(0);
  const { locations } = placeState;
  const loading = placeState.status === 'loading';
  const error = placeState.status === 'error';
  const sourcePending = placeState.source === 'loading';
  function retry() {
    setPlaceState((previous) =>
      previous.status === 'ready'
        ? { ...previous, source: 'loading' }
        : { status: 'loading', source: 'loading', locations: [] },
    );
    setPlaceAttempt((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    void loadMapLocations(school).then(
      (loaded) => {
        if (active)
          setPlaceState({
            status: 'ready',
            source: 'ready',
            locations: withProvidenceCampusPlaces(school, loaded),
          });
      },
      () => {
        if (!active) return;
        setPlaceState((previous) =>
          bundled
            ? { status: 'ready', source: 'error', locations: previous.locations.length ? previous.locations : withProvidenceCampusPlaces(school, []) }
            : { status: 'error', source: 'error', locations: [] },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [school, placeAttempt, bundled]);
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
    const matched = locations.filter(
      (location) =>
        (category === '全部' || location.category === category) &&
        locationMatchesSearch(location, search) &&
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
  const walkFrom = myLocation ?? (school === 'pu' ? PROVIDENCE_WALK_ORIGIN : null);
  const walkFromGate = Boolean(walkFrom && !myLocation);
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
        正在載入校園地點…（最多約 8 秒，讀不到會提示並可重試）
      </div>
    );
  if (error)
    return (
      <div className={`card ${styles.state}`} role="alert">
        <h2>暫時無法取得校園地點</h2>
        <p>地點資料連線逾時或失敗，請檢查網路後重新載入。確認地點資料後，就能搜尋設施與開啟導航。</p>
        <div className={styles.actions}>
          <button className="btn" onClick={retry}>
            重新載入地點
          </button>
          {officialMapUrl && (
            <a className="btn" href={officialMapUrl} target="_blank" rel="noopener noreferrer">
              查看校方校區平面圖
            </a>
          )}
        </div>
      </div>
    );
  if (!locations.length)
    return (
      <div className={`card ${styles.state}`}>
        <h2>目前沒有可顯示的校園地點</h2>
        <p>地點需要有完整的名稱與座標才能顯示。你也可以先查詢校方提供的校園資訊。</p>
        <p>目前還沒有這所校園可顯示的地點清單，不會改用其他學校的建築或導航位置。</p>
        <div className={styles.actions}>
          {officialMapUrl && (
            <a className="btn" href={officialMapUrl} target="_blank" rel="noopener noreferrer">
              查看校方校區平面圖
            </a>
          )}
          {fallbackMapUrl && (
            <a className="btn" href={fallbackMapUrl} target="_blank" rel="noopener noreferrer">
              在 Google 地圖搜尋{schoolName} ↗
            </a>
          )}
        </div>
        {officialMapUrl && (
          <p>校方發布的平面圖可用來核對校舍位置，不代表已有可用於程式導航的建築座標。</p>
        )}
        {fallbackMapUrl && (
          <p>第三方地圖搜尋的地點及路線仍需核對，不能視為校方已發布的資料。</p>
        )}
      </div>
    );

  return (
    <div className={`pageStack ${styles.page}`} data-map-first-screen="true">
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
        <div className={styles.searchRow}>
          <label className={styles.search}>
            <span className={styles.searchLabel}>搜尋地點</span>
            <input
              className="input"
              type="search"
              aria-label="搜尋地點"
              placeholder="宿舍、影印或公車"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="btn"
            onClick={locate}
            disabled={positionStatus === 'loading'}
            aria-label={myLocation ? '更新我的位置' : '查看我的位置'}
          >
            {positionStatus === 'loading' ? '定位中…' : myLocation ? '更新定位' : '定位'}
          </button>
        </div>
        {positionError && <p className={styles.notice} role="alert">{positionError}</p>}
        {myLocation && (
          <p className={styles.note} role="status">
            已定位，地點依直線距離由近到遠排序；校園步道與路口請以實際路線為準。
          </p>
        )}
      </div>
      <MapCanvas
        locations={mapLocations}
        selected={selected}
        route={routeLocations}
        myLocation={myLocation}
        onSelect={selectLocation}
      />
      {placeState.source === 'error' && (
        <div className={styles.notice} role="alert">
          <p>校方地點資料暫時讀不到，先顯示目前可用的靜宜地點，收藏與部分地點可能缺少。</p>
          <button className="btn" onClick={retry}>
            重新讀取地點資料
          </button>
        </div>
      )}
      {sourcePending && bundled && (
        <p className={styles.note} role="status">
          正在同步校方地點資料，已先顯示靜宜的預載地點。
        </p>
      )}
      {!sourcePending && route && !deepLinkRoute && routeDraft === null && (
        <p className={styles.notice} role="status">
          這個連結的起點或終點已不在目前地點資料中，請從下方列表重新選擇。
        </p>
      )}
      {!sourcePending && focus && !locations.some((location) => location.id === focus) && (
        <p className={styles.notice} role="status">
          找不到連結指定的地點，請搜尋地點名稱。
        </p>
      )}
      {school === 'pu' && (
        <section className={`card ${styles.source}`} aria-label="地圖資料來源">
          <details>
            <summary>靜宜地圖資料來源與步行分鐘算法</summary>
            <p>
              預載目錄中的建築與設施位置取自{' '}
              <a href={PROVIDENCE_CAMPUS_SOURCE.mapDataUrl} target="_blank" rel="noopener noreferrer">
                OpenStreetMap 貢獻者資料
              </a>
              （查詢日期 {PROVIDENCE_CAMPUS_SOURCE.retrievedAt}），並與{' '}
              <a href={PROVIDENCE_CAMPUS_SOURCE.officialCampusTourUrl} target="_blank" rel="noopener noreferrer">
                校方校園地圖實境導覽
              </a>
              交叉核對名稱；底圖上也保留 OpenStreetMap 署名。宿舍與影印只掛在已核對建築；宿舍衛浴／盥洗僅供住宿生、訪客可否使用尚未核實，未另放已核對的公共廁所座標。
              預載公車站牌取自{' '}
              <a href={PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl} target="_blank" rel="noopener noreferrer">
                臺中市公車站牌資料
              </a>
              （快照 {PROVIDENCE_CAMPUS_SOURCE.transitCatalogDate}）。點公車站可到公車頁看即時到站；
              出入口目前只有一筆標記、名稱待補，其他學校的地點待補，不會先用靜宜資料代替。
              步行分鐘是直線公尺 ÷ 每分鐘 80 公尺後四捨五入，不是導航路線時間。
            </p>
          </details>
        </section>
      )}
      <div className={styles.tools}>
        {officialMapUrl && (
          <a className="btn" href={officialMapUrl} target="_blank" rel="noopener noreferrer">
            校方校區平面圖
          </a>
        )}
        <button
          className="btn"
          onClick={() => {
            setSelection('');
            setSearch('');
            setCategory('全部');
          }}
        >
          看整個校園
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
            {walkFrom && (
              <p>
                {walkFromGate
                  ? `從校園出入口（OpenStreetMap 閘門標記）直線約 ${formatDistance(distanceMeters(walkFrom, selected))}；`
                  : `距離我的位置約 ${formatDistance(distanceMeters(walkFrom, selected))}（直線距離）；`}
                {walkingEstimateLabel(distanceMeters(walkFrom, selected))}
              </p>
            )}
            {isProvidencePendingVerification(school, selected) && (
              <p role="status">這個地點目前只有單一資料來源，位置待再次確認，先不要把它當成已核對的導航點。</p>
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
              {isBusStopLocation(selected) && (
                <Link className="btn primary" href={`/bus?schoolId=${encodeURIComponent(school)}`}>
                  查看即時到站
                </Link>
              )}
              {providencePlaceSourceUrl(school, selected) && (
                <a
                  className="btn"
                  href={providencePlaceSourceUrl(school, selected)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看地點來源 ↗
                </a>
              )}
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
                  <span className={styles.locationName}>
                    {location.name}
                    {isProvidencePendingVerification(school, location) && (
                      <span className={styles.pending}>待確認</span>
                    )}
                  </span>
                  <span className={styles.note}>
                    {[location.category, location.building, location.floor && `樓層：${location.floor}`].filter(Boolean).join(' · ')}
                    {walkFrom &&
                      ` · ${walkFromGate ? '從校園出入口直線' : '直線距離'} ${formatDistance(distanceMeters(walkFrom, location))} · ${walkingEstimateLabel(distanceMeters(walkFrom, location))}`}
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
