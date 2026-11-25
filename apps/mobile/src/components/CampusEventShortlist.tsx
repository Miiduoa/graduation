import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SavedCampusEvent } from '@campus/shared/src/campusEventShortlist';
import type { useCampusEventShortlist } from '../state/campusEventShortlist';
import { AICard, AIButton, AISection, aiTokens } from '../ui/aiFirst';

type Shortlist = ReturnType<typeof useCampusEventShortlist>;

export function EventShortlistTabs({
  saved,
  count,
  onChange,
}: {
  saved: boolean;
  count: number;
  onChange: (next: boolean) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        marginHorizontal: aiTokens.space.md,
        flexDirection: 'row',
        padding: 3,
        borderRadius: aiTokens.radius.md,
        backgroundColor: aiTokens.panel,
      }}
    >
      {['探索活動', '已收藏'].map((label, index) => {
        const selected = saved === (index === 1);
        return (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onChange(index === 1)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              padding: 6,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: aiTokens.radius.sm,
              backgroundColor: selected ? aiTokens.surface : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: selected ? aiTokens.text : aiTokens.muted,
                fontWeight: selected ? '700' : '500',
                textAlign: 'center',
              }}
            >
              {label}
              {index === 1 && count > 0 ? `（${count}）` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EventSaveButton({
  event,
  shortlist,
  showLabel = false,
  accessibleTitle = event.title,
}: {
  event: SavedCampusEvent;
  shortlist: Shortlist;
  showLabel?: boolean;
  accessibleTitle?: string;
}) {
  if (!shortlist.available) return null;
  const saved = shortlist.items.some(
    (row) => row.schoolId === event.schoolId && row.source === event.source && row.id === event.id,
  );
  const color = saved ? aiTokens.ai : aiTokens.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${saved ? '取消收藏' : '收藏活動'}：${accessibleTitle}`}
      accessibilityState={{ selected: saved, disabled: !shortlist.ready }}
      disabled={!shortlist.ready}
      onPress={() => shortlist.setSaved(event, !saved)}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: showLabel ? 12 : 6,
        borderRadius: aiTokens.radius.sm,
        backgroundColor: showLabel && saved ? aiTokens.aiSoft : 'transparent',
        opacity: !shortlist.ready || pressed ? 0.5 : 1,
      })}
    >
      <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={color} />
      {showLabel && (
        <Text style={{ color, fontWeight: '600' }}>{saved ? '已收藏' : '收藏活動'}</Text>
      )}
    </Pressable>
  );
}

export function EventShortlistError({ shortlist }: { shortlist: Shortlist }) {
  if (!shortlist.error) return null;
  return (
    <AICard>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
          {shortlist.error}
        </Text>
        {!shortlist.ready && (
          <AIButton label="重新讀取收藏" variant="ghost" onPress={shortlist.reload} />
        )}
      </View>
    </AICard>
  );
}

const sourceNames: Record<SavedCampusEvent['source'], string> = {
  'school-club-events': '社團活動',
  'school-events': '學校活動',
  'legacy-events': '校園活動',
};

export function SavedEventList({
  shortlist,
  onOpen,
  onExplore,
}: {
  shortlist: Shortlist;
  onOpen: (event: SavedCampusEvent) => void;
  onExplore: () => void;
}) {
  if (!shortlist.available) {
    return (
      <AICard title={shortlist.scopeNotice ?? undefined}>
        <AIButton label="瀏覽校園活動" variant="ghost" onPress={onExplore} />
      </AICard>
    );
  }
  if (!shortlist.ready) {
    return shortlist.error ? null : <AICard title="正在讀取收藏">{null}</AICard>;
  }
  if (!shortlist.items.length) {
    return (
      <AICard title="還沒有收藏活動">
        <View style={{ gap: 12 }}>
          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
            在活動旁點選書籤，就能回到這裡查看。
          </Text>
          <AIButton label="瀏覽校園活動" variant="ghost" onPress={onExplore} />
        </View>
      </AICard>
    );
  }
  return (
    <AISection title="收藏活動" subtitle="收藏保存在這台裝置。點選活動可查看最新詳情。">
      {shortlist.items.map((event, index) => {
        const duplicate = shortlist.items.some(
          (row, other) => other !== index && row.title === event.title,
        );
        const accessibleTitle = duplicate
          ? `${event.title}，${sourceNames[event.source]}，第 ${index + 1} 場`
          : event.title;
        return (
          <View
            key={`${event.source}:${event.id}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingRight: 8,
              borderTopColor: aiTokens.border,
              borderTopWidth: index ? StyleSheet.hairlineWidth : 0,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`查看活動：${accessibleTitle}`}
              accessibilityHint={sourceNames[event.source]}
              onPress={() => onOpen(event)}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: 56,
                padding: 14,
                gap: 4,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>
                {event.title}
              </Text>
              <Text style={{ color: aiTokens.muted, fontSize: 13 }}>
                {sourceNames[event.source]}
              </Text>
            </Pressable>
            <EventSaveButton
              event={event}
              shortlist={shortlist}
              accessibleTitle={accessibleTitle}
            />
          </View>
        );
      })}
    </AISection>
  );
}
