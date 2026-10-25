import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../ui/theme';
import { adminWorkbenchStyles as styles } from './adminWorkbenchStyles';

export type AdminTabKey = 'overview' | 'announcements' | 'events' | 'members' | 'settings';

export type AdminTabItem = {
  key: AdminTabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export const ADMIN_TABS: AdminTabItem[] = [
  { key: 'overview', label: '總覽', icon: 'grid-outline' },
  { key: 'announcements', label: '公告', icon: 'newspaper-outline' },
  { key: 'events', label: '活動', icon: 'calendar-outline' },
  { key: 'members', label: '成員', icon: 'people-outline' },
  { key: 'settings', label: '設定', icon: 'settings-outline' },
];

function TabChip(props: {
  item: AdminTabItem;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: props.active }}
      accessibilityLabel={props.item.label}
      style={[styles.tabButton, props.active ? styles.tabButtonActive : null]}
    >
      <Ionicons
        name={props.item.icon}
        size={18}
        color={props.active ? theme.colors.accent : theme.colors.muted}
      />
      <Text style={[styles.tabLabel, props.active ? styles.tabLabelActive : null]}>
        {props.item.label}
      </Text>
    </Pressable>
  );
}

/**
 * Horizontal scroll when tabs would squeeze; wrap layout when the row is wide enough.
 * Component-level layout checks are not a substitute for real-device acceptance.
 */
export function AdminTabBar(props: {
  active: AdminTabKey;
  onChange: (key: AdminTabKey) => void;
  items?: AdminTabItem[];
}) {
  const items = props.items ?? ADMIN_TABS;
  const { width } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const needsScroll = width > 0 && contentWidth > width - 8;

  const onContentLayout = (event: LayoutChangeEvent) => {
    setContentWidth(event.nativeEvent.layout.width);
  };

  const chips = items.map((item) => (
    <TabChip
      key={item.key}
      item={item}
      active={props.active === item.key}
      onPress={() => props.onChange(item.key)}
    />
  ));

  if (needsScroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        accessibilityRole="tablist"
      >
        <View style={{ flexDirection: 'row', gap: 8 }} onLayout={onContentLayout}>
          {chips}
        </View>
      </ScrollView>
    );
  }

  return (
    <View
      style={styles.tabWrap}
      onLayout={onContentLayout}
      accessibilityRole="tablist"
    >
      {chips}
    </View>
  );
}
