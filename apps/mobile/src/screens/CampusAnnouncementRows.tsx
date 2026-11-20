import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formatSyncedAnnouncementDate } from '../services/syncedAnnouncementQuery';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { aiTokens } from '../ui/aiFirst';

type Announcement = CampusSenseSnapshot['announcements']['items'][number];

export function CampusAnnouncementRows({ items, disabled, onOpenAnnouncement }: {
  items: ReadonlyArray<Announcement>;
  disabled: boolean;
  onOpenAnnouncement?: (item: Announcement) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((item, index) => {
        const published = formatSyncedAnnouncementDate(item.publishedAt);
        const date = published ? `${published} 發布` : '未提供發布日期';
        const label = `第 ${index + 1} 則，${item.title}，${date}`;
        const row = (
          <>
            <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 15 }}>{item.title}</Text>
            <Text style={{ color: aiTokens.muted, fontSize: 13 }}>{date}</Text>
          </>
        );
        const style = { backgroundColor: aiTokens.panel, borderRadius: 12, padding: 12, gap: 6 };
        if (!item.source || !onOpenAnnouncement) {
          return <View key={index} accessible accessibilityLabel={label} style={style}>{row}</View>;
        }
        return (
          <TouchableOpacity key={index} accessibilityRole="button"
            accessibilityLabel={`開啟公告，${label}`} accessibilityState={{ disabled }}
            disabled={disabled} onPress={() => onOpenAnnouncement(item)}
            style={[style, { minHeight: 48, opacity: disabled ? 0.6 : 1 }]}>
            {row}
            <Text style={{ color: aiTokens.ai, fontWeight: '600', fontSize: 13 }}>查看公告內容</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
