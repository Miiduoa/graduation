import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import { useAdminWorkbenchStyles } from './adminWorkbenchStyles';

export type AdminTabKey = 'overview' | 'announcements' | 'events' | 'members' | 'settings';

export type AdminTabItem = {
  key: AdminTabKey;
  label: string;
  /** Kept for callers that still pass icons; the text-tab layout does not render it. */
  icon: keyof typeof Ionicons.glyphMap;
};

export const ADMIN_TABS: AdminTabItem[] = [
  { key: 'overview', label: '總覽', icon: 'grid-outline' },
  { key: 'announcements', label: '公告', icon: 'newspaper-outline' },
  { key: 'events', label: '活動', icon: 'calendar-outline' },
  { key: 'members', label: '成員', icon: 'people-outline' },
  { key: 'settings', label: '設定', icon: 'settings-outline' },
];

function TabItem(props: {
  item: AdminTabItem;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useAdminWorkbenchStyles();
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: props.active }}
      accessibilityLabel={props.item.label}
      style={[styles.tabButton, props.active ? styles.tabButtonActive : null]}
    >
      <Text style={[styles.tabLabel, props.active ? styles.tabLabelActive : null]}>
        {props.item.label}
      </Text>
    </Pressable>
  );
}

/**
 * Text tabs with an underlined active item. The row always scrolls horizontally,
 * so large text sizes or narrow screens never squeeze or clip a tab.
 */
export function AdminTabBar(props: {
  active: AdminTabKey;
  onChange: (key: AdminTabKey) => void;
  items?: AdminTabItem[];
}) {
  const styles = useAdminWorkbenchStyles();
  const items = props.items ?? ADMIN_TABS;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabScroll}
      contentContainerStyle={styles.tabScrollContent}
      accessibilityRole="tablist"
    >
      {items.map((item) => (
        <TabItem
          key={item.key}
          item={item}
          active={props.active === item.key}
          onPress={() => props.onChange(item.key)}
        />
      ))}
    </ScrollView>
  );
}
