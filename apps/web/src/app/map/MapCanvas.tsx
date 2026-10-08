'use client';

import { useEffect, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { MapLocation } from './mapService';
import styles from './map.module.css';

type LeafletModule = typeof import('leaflet');

export default function MapCanvas({
  locations,
  selected,
  route,
  onSelect,
}: {
  locations: MapLocation[];
  selected: MapLocation | null;
  route: [MapLocation, MapLocation] | null;
  onSelect: (location: MapLocation) => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [runtime, setRuntime] = useState<{ map: LeafletMap; L: LeafletModule } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container) return;
    let active = true;
    let map: LeafletMap | null = null;
    void import('leaflet')
      .then((L) => {
        if (!active) return;
        map = L.map(container, { zoomControl: false });
        L.control.zoom({ zoomInTitle: '放大地圖', zoomOutTitle: '縮小地圖' }).addTo(map);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        });
        tiles.on('tileerror', () => {
          if (active) setError(true);
        });
        tiles.addTo(map);
        setRuntime({ map, L });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      map?.remove();
    };
  }, [container, attempt]);

  useEffect(() => {
    if (!runtime) return;
    const { map, L } = runtime;
    const markers = L.layerGroup().addTo(map);
    for (const location of locations) {
      const pin = document.createElement('span');
      pin.className = styles.pin;
      const tooltip = document.createElement('span');
      // Leaflet interprets string tooltips as HTML; location names are plain text.
      tooltip.textContent = location.name;
      L.marker([location.lat, location.lng], {
        icon: L.divIcon({ html: pin, className: '', iconSize: [28, 28], iconAnchor: [14, 28] }),
        title: location.name,
        alt: location.name,
        keyboard: true,
      })
        .bindTooltip(tooltip, { direction: 'top', offset: [0, -28] })
        .on('click', () => onSelect(location))
        .addTo(markers);
    }
    return () => {
      markers.remove();
    };
  }, [runtime, locations, onSelect]);

  useEffect(() => {
    if (!runtime) return;
    const { map, L } = runtime;
    if (selected) {
      map.setView([selected.lat, selected.lng], 18);
    } else {
      const visible = route ?? locations;
      if (visible.length) {
        map.fitBounds(L.latLngBounds(visible.map((location) => [location.lat, location.lng])), {
          padding: [40, 40],
          maxZoom: 17,
        });
      }
    }
  }, [runtime, selected, route, locations]);

  return (
    <div className={styles.mapFrame}>
      <div ref={setContainer} className={styles.map} role="region" aria-label="校園地點地圖" />
      {error && (
        <div className={styles.mapNotice} role="status">
          <p>底圖暫時無法載入。仍可使用下方地點列表與步行導航。</p>
          <button
            className="btn"
            onClick={() => {
              setRuntime(null);
              setError(false);
              setAttempt((value) => value + 1);
            }}
          >
            重新載入底圖
          </button>
        </div>
      )}
    </div>
  );
}
