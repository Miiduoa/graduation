/* eslint-disable */
/**
 * 室內樓層平面圖（IndoorFloorMapScreen）
 *
 * 渲染策略：用 WebView + 動態產生的 SVG（跟 Leaflet maps 同一套技術）
 *  - 樓層切換 tabs（B1/1F/2F/3F/4F）
 *  - 房間點擊出底部 sheet 詳情（容量、人潮、設備）
 *  - 樓內搜尋（找電腦 / 找位置 / R301）
 *  - persona.nextClass.roomCode 若在此棟建築 → 自動高亮閃爍 + label「下節課在這裡」
 *  - 多樓層導航提示（先到 X 電梯 → 上 N 樓 → 走 X 公尺）
 *
 * 進入方式：
 *   nav.navigate('IndoorFloorMap', { buildingId: 'lib', floorId?, roomId? })
 *   或
 *   nav.navigate('IndoorFloorMap', { poiId: 'pu-library' })
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { WebView } from 'react-native-webview';
import { PuWebView } from '../ui/PuWebView';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { usePersonaContext } from '../services/personaContext';
import {
  ALL_INDOOR_MAPS,
  getIndoorMapById,
  getIndoorMapByPoi,
  searchRoomsInBuilding,
  getRoomCrowd,
  crowdLabel,
  ROOM_KIND_LABEL,
  ROOM_KIND_COLOR,
  ROOM_KIND_EMOJI,
  type IndoorMap,
  type IndoorFloor,
  type IndoorRoom,
} from '../data/indoorMaps';

type Params = {
  buildingId?: string;
  poiId?: string;
  floorId?: string;
  roomId?: string;
  /** 由 persona.nextClass 帶入的房號（會自動定位） */
  roomCode?: string;
};

export function IndoorFloorMapScreen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Params;
  const persona = usePersonaContext();
  const webRef = useRef<WebView>(null);

  // ── Resolve building ──
  const building: IndoorMap | null = useMemo(() => {
    if (params.buildingId) return getIndoorMapById(params.buildingId);
    if (params.poiId) return getIndoorMapByPoi(params.poiId);
    return ALL_INDOOR_MAPS[0] ?? null;
  }, [params.buildingId, params.poiId]);

  // ── Active floor ──
  const initialFloorId = useMemo(() => {
    if (!building) return null;
    if (params.floorId) return params.floorId;
    // 若 persona.nextClass 在此棟，自動跳到那層
    if (persona.nextClass) {
      const code = persona.nextClass.roomCode;
      for (const f of building.floors) {
        if (f.rooms.some((r) => r.code === code)) return f.id;
      }
    }
    // 若 params.roomCode 在此棟
    if (params.roomCode) {
      for (const f of building.floors) {
        if (f.rooms.some((r) => r.code === params.roomCode)) return f.id;
      }
    }
    return building.defaultFloorId;
  }, [building, params.floorId, params.roomCode, persona.nextClass]);

  const [floorId, setFloorId] = useState<string | null>(initialFloorId);
  useEffect(() => {
    setFloorId(initialFloorId);
  }, [initialFloorId]);

  const floor: IndoorFloor | null = useMemo(() => {
    if (!building || !floorId) return null;
    return building.floors.find((f) => f.id === floorId) ?? null;
  }, [building, floorId]);

  // ── Selected room ──
  const initialSelectedRoomId = useMemo(() => {
    if (!floor) return null;
    if (params.roomId) return params.roomId;
    // persona match
    if (persona.nextClass) {
      const r = floor.rooms.find((r) => r.code === persona.nextClass!.roomCode);
      if (r) return r.id;
    }
    if (params.roomCode) {
      const r = floor.rooms.find((r) => r.code === params.roomCode);
      if (r) return r.id;
    }
    return null;
  }, [floor, params.roomId, params.roomCode, persona.nextClass]);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialSelectedRoomId);
  useEffect(() => {
    setSelectedRoomId(initialSelectedRoomId);
  }, [initialSelectedRoomId]);

  const selectedRoom: IndoorRoom | null = useMemo(() => {
    if (!floor || !selectedRoomId) return null;
    return floor.rooms.find((r) => r.id === selectedRoomId) ?? null;
  }, [floor, selectedRoomId]);

  // ── Search ──
  const [q, setQ] = useState('');
  const searchResults = useMemo(() => {
    if (!building || !q.trim()) return [];
    return searchRoomsInBuilding(building.id, q.trim()).slice(0, 8);
  }, [building, q]);

  // ── persona room match (for highlight) ──
  const personaHighlightRoomId: string | null = useMemo(() => {
    if (!floor || !persona.nextClass) return null;
    const r = floor.rooms.find((rm) => rm.code === persona.nextClass!.roomCode);
    return r?.id ?? null;
  }, [floor, persona.nextClass]);

  // ── 多樓層導航提示 ──
  const navigationHint = useMemo(() => {
    if (!building || !persona.nextClass) return null;
    // 找下節課房間在這棟的哪層
    let targetFloor: IndoorFloor | null = null;
    let targetRoom: IndoorRoom | null = null;
    for (const f of building.floors) {
      const r = f.rooms.find((rm) => rm.code === persona.nextClass!.roomCode);
      if (r) {
        targetFloor = f;
        targetRoom = r;
        break;
      }
    }
    if (!targetFloor || !targetRoom || !floor) return null;
    if (targetFloor.id === floor.id) {
      return {
        sameFloor: true,
        text: `${persona.displayName}，${persona.nextClass.courseName}的教室 ${targetRoom.code} 就在這層`,
      };
    }
    return {
      sameFloor: false,
      text: `你的下節課在 ${targetFloor.shortLabel} ${targetRoom.code}`,
      actionLabel: `切到 ${targetFloor.shortLabel}`,
      action: () => setFloorId(targetFloor!.id),
    };
  }, [building, floor, persona.nextClass, persona.displayName]);

  // ── Generate SVG HTML ──
  const svgHtml = useMemo(() => {
    if (!building || !floor) return '<html><body></body></html>';
    return buildSvgHtml(building, floor, {
      selectedRoomId,
      personaHighlightRoomId,
    });
  }, [building, floor, selectedRoomId, personaHighlightRoomId]);

  // ── WebView message ──
  const onWebMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'roomTap') {
        setSelectedRoomId(data.id);
        analytics.logEvent('indoor_room_tap', { id: data.id });
      }
    } catch {}
  }, []);

  useEffect(() => {
    analytics.logScreenView('IndoorFloorMap');
  }, []);

  if (!building) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Ionicons name="business-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.text, fontSize: 16, marginTop: 12 }}>
            此建築物尚未提供樓層平面圖
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* Hero header */}
      <View
        style={{
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 8,
          backgroundColor: theme.colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => nav.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </Pressable>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: building.themeColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="business" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '900' }}>
              {building.name}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
              {building.description}
            </Text>
          </View>
          <Pressable
            onPress={() => nav.navigate('MapV2', { focusPoi: building.poiId })}
            hitSlop={8}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: theme.colors.accentSoft,
              flexDirection: 'row',
              gap: 4,
              alignItems: 'center',
            }}
          >
            <Ionicons name="map-outline" size={13} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>
              外部地圖
            </Text>
          </Pressable>
        </View>

        {/* Floor tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingTop: 8 }}
        >
          {[...building.floors]
            .sort((a, b) => b.level - a.level)
            .map((f) => {
              const active = f.id === floorId;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    setFloorId(f.id);
                    setSelectedRoomId(null);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 99,
                    backgroundColor: active ? building.themeColor : theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: active ? building.themeColor : theme.colors.border,
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: active ? '#fff' : theme.colors.textSecondary,
                      fontSize: 13,
                      fontWeight: '800',
                    }}
                  >
                    {f.shortLabel}
                  </Text>
                  {active && (
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 9, marginTop: 1 }}>
                      {f.name}
                    </Text>
                  )}
                </Pressable>
              );
            })}
        </ScrollView>
      </View>

      {/* Persona navigation hint */}
      {navigationHint && (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 8,
            padding: 10,
            borderRadius: 12,
            backgroundColor: navigationHint.sameFloor
              ? `${theme.colors.success}22`
              : `${theme.colors.accent}22`,
            borderWidth: 1,
            borderColor: navigationHint.sameFloor
              ? `${theme.colors.success}55`
              : `${theme.colors.accent}55`,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Ionicons
            name="school"
            size={16}
            color={navigationHint.sameFloor ? theme.colors.success : theme.colors.accent}
          />
          <Text style={{ flex: 1, color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
            {navigationHint.text}
          </Text>
          {!navigationHint.sameFloor && 'action' in navigationHint && (
            <Pressable
              onPress={navigationHint.action}
              hitSlop={8}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                {navigationHint.actionLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Search bar */}
      <View
        style={{
          marginHorizontal: 12,
          marginTop: 8,
          flexDirection: 'row',
          gap: 6,
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: theme.colors.surface,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Ionicons name="search" size={14} color={theme.colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="搜尋電腦／座位／R301／討論室..."
          placeholderTextColor={theme.colors.muted}
          style={{ flex: 1, color: theme.colors.text, fontSize: 13, paddingVertical: 0 }}
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>

      {/* Search results dropdown */}
      {searchResults.length > 0 && (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 4,
            padding: 4,
            backgroundColor: theme.colors.surface,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            maxHeight: 200,
          }}
        >
          <ScrollView>
            {searchResults.map(({ floor: f, room: r }) => (
              <Pressable
                key={`${f.id}-${r.id}`}
                onPress={() => {
                  setFloorId(f.id);
                  setSelectedRoomId(r.id);
                  setQ('');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 8,
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                  alignItems: 'center',
                })}
              >
                <Text style={{ fontSize: 16 }}>{ROOM_KIND_EMOJI[r.kind]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                    {r.name} · {r.code}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }} numberOfLines={1}>
                    {f.shortLabel} · {ROOM_KIND_LABEL[r.kind]}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* SVG WebView */}
      <View
        style={{
          flex: 1,
          marginHorizontal: 12,
          marginTop: 8,
          marginBottom: selectedRoom ? 220 : 12,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <PuWebView
          ref={webRef}
          source={{ html: svgHtml }}
          style={{ flex: 1, backgroundColor: '#FAFAFA' }}
          onMessage={onWebMessage}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
        />
        {/* Floor caption overlay */}
        {floor && (
          <View
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              backgroundColor: 'rgba(0,0,0,0.7)',
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
              {floor.shortLabel} · {floor.highlight}
            </Text>
          </View>
        )}
      </View>

      {/* Selected room sheet */}
      {selectedRoom && floor && (
        <RoomSheet
          room={selectedRoom}
          floor={floor}
          isPersonaTarget={selectedRoom.id === personaHighlightRoomId}
          personaName={persona.displayName}
          onClose={() => setSelectedRoomId(null)}
          themeColor={building.themeColor}
        />
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════
// Selected Room bottom sheet
// ═════════════════════════════════════════════════════
function RoomSheet({
  room,
  floor,
  isPersonaTarget,
  personaName,
  onClose,
  themeColor,
}: {
  room: IndoorRoom;
  floor: IndoorFloor;
  isPersonaTarget: boolean;
  personaName: string;
  onClose: () => void;
  themeColor: string;
}) {
  const crowd = getRoomCrowd(room.id, room.defaultCrowd);
  const crowdInfo = crowdLabel(crowd);
  const occRate =
    typeof room.capacity === 'number' && room.capacity > 0
      ? Math.min(1, (crowdToOccupancyRate(crowd) * room.capacity) / room.capacity)
      : null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        padding: 14,
        borderWidth: isPersonaTarget ? 2 : 1,
        borderColor: isPersonaTarget ? '#FBBF24' : theme.colors.border,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: `${ROOM_KIND_COLOR[room.kind]}22`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 20 }}>{ROOM_KIND_EMOJI[room.kind]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '900', fontSize: 16 }}>
            {room.name} · {room.code}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
            {floor.shortLabel} · {ROOM_KIND_LABEL[room.kind]}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close-circle" size={22} color={theme.colors.muted} />
        </Pressable>
      </View>

      {isPersonaTarget && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            padding: 8,
            borderRadius: 10,
            backgroundColor: '#FBBF2422',
            borderWidth: 1,
            borderColor: '#FBBF2455',
          }}
        >
          <Ionicons name="school" size={14} color="#FF9500" />
          <Text style={{ color: '#FF9500', fontSize: 11, fontWeight: '800' }}>
            這是 {personaName} 下節課的教室
          </Text>
        </View>
      )}

      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
        {room.description}
      </Text>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <StatChip
          icon="people-outline"
          label="人潮"
          value={crowdInfo.text}
          color={crowdInfo.color}
        />
        {room.capacity != null && (
          <StatChip
            icon="grid-outline"
            label="容量"
            value={`${room.capacity} 位`}
            color={themeColor}
          />
        )}
        {room.openTime && (
          <StatChip
            icon="time-outline"
            label="開放"
            value={room.openTime}
            color={theme.colors.muted}
          />
        )}
      </View>

      {/* Facilities chips */}
      {room.facilities.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {room.facilities.map((f) => (
            <View
              key={f}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 99,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '600' }}>{f}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Action row */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {room.bookable && (
          <Pressable
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: pressed ? `${theme.colors.accent}DD` : theme.colors.accent,
              alignItems: 'center',
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>預約</Text>
          </Pressable>
        )}
        {room.requiresCard && (
          <View
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.colors.muted, fontWeight: '700', fontSize: 12 }}>
              🔑 需識別卡
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderRadius: 10,
        backgroundColor: `${color}11`,
        borderWidth: 1,
        borderColor: `${color}33`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={11} color={color} />
        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{label}</Text>
      </View>
      <Text style={{ color, fontSize: 12, fontWeight: '800', marginTop: 2 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function crowdToOccupancyRate(c: ReturnType<typeof getRoomCrowd>): number {
  switch (c) {
    case 'empty':
      return 0;
    case 'low':
      return 0.25;
    case 'medium':
      return 0.55;
    case 'high':
      return 0.85;
    case 'full':
      return 1;
  }
}

// ═════════════════════════════════════════════════════
// SVG HTML builder
// ═════════════════════════════════════════════════════
function buildSvgHtml(
  building: IndoorMap,
  floor: IndoorFloor,
  opts: { selectedRoomId: string | null; personaHighlightRoomId: string | null },
): string {
  const { width, height } = building.viewBox;
  const themeColor = building.themeColor;

  const rooms = floor.rooms
    .map((r) => {
      const isSel = r.id === opts.selectedRoomId;
      const isPersona = r.id === opts.personaHighlightRoomId;
      const fill = isSel
        ? hexWithAlpha(ROOM_KIND_COLOR[r.kind], 0.55)
        : isPersona
          ? '#FEF3C7'
          : hexWithAlpha(ROOM_KIND_COLOR[r.kind], 0.22);
      const stroke = isSel
        ? ROOM_KIND_COLOR[r.kind]
        : isPersona
          ? '#FBBF24'
          : hexWithAlpha(ROOM_KIND_COLOR[r.kind], 0.55);
      const strokeWidth = isSel || isPersona ? 3 : 1.5;
      const points = r.polygon.map((p) => `${p.x},${p.y}`).join(' ');
      const labelLines = [r.name, r.code].filter(Boolean);
      const fontSize = Math.max(13, Math.min(18, Math.sqrt(polygonArea(r.polygon)) / 8));
      return `
<g class="room" data-id="${r.id}" onclick="onRoomTap('${r.id}')">
  <polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
    ${isPersona ? 'class="pulse"' : ''}
  />
  ${labelLines
    .map(
      (line, i) =>
        `<text x="${r.labelAt.x}" y="${r.labelAt.y + i * (fontSize + 2) - (labelLines.length - 1) * (fontSize + 2) / 2}" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, system-ui, sans-serif" font-size="${i === 0 ? fontSize : fontSize - 3}" font-weight="${i === 0 ? '700' : '600'}" fill="${isSel ? '#0F172A' : '#334155'}" pointer-events="none">${escapeXml(line)}</text>`,
    )
    .join('')}
</g>`;
    })
    .join('\n');

  const verticalIcons = floor.vertical
    .map((v) => {
      const icon = v.kind === 'elevator' ? '⬆' : '↗';
      return `
<g class="vert">
  <circle cx="${v.at.x}" cy="${v.at.y}" r="14" fill="#fff" stroke="#475569" stroke-width="2"/>
  <text x="${v.at.x}" y="${v.at.y}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="800" fill="#475569">${icon}</text>
  <text x="${v.at.x}" y="${v.at.y + 22}" text-anchor="middle" font-size="9" font-weight="600" fill="#64748B">${escapeXml(v.label)}</text>
</g>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#FAFAFA;overflow:hidden;font-family:-apple-system, system-ui, sans-serif}
  svg{width:100%;height:100%;display:block}
  .room{cursor:pointer;transition:filter .15s}
  .room:active{filter:brightness(0.95)}
  .pulse{animation:pulse 1.8s ease-in-out infinite}
  @keyframes pulse{
    0%,100%{stroke-width:3;filter:drop-shadow(0 0 0 rgba(251,191,36,0.0))}
    50%{stroke-width:5;filter:drop-shadow(0 0 10px rgba(251,191,36,0.7))}
  }
  .legend{position:absolute;bottom:8px;right:8px;background:rgba(255,255,255,0.92);padding:6px 8px;border-radius:8px;font-size:9px;color:#64748B;border:1px solid #E2E8F0;font-weight:600}
</style>
</head><body>
<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" stroke-width="0.5"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#grid)" />
  ${rooms}
  ${verticalIcons}
  <text x="${width - 30}" y="30" font-size="14" font-weight="800" fill="${themeColor}">N ↑</text>
</svg>
<div class="legend">點房間查看詳情</div>
<script>
function onRoomTap(id){
  try{
    if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'roomTap',id:id}));
    }
  }catch(e){}
}
</script>
</body></html>`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  // hex like '#34C759' or '#34C759XX' — we just append alpha as 2-digit hex
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  if (hex.length === 7) return `${hex}${a}`;
  return hex;
}

function polygonArea(poly: { x: number; y: number }[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(area / 2);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default IndoorFloorMapScreen;
