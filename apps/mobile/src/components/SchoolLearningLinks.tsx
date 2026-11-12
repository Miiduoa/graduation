import React, { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getSchoolLearningEntry } from '@campus/shared/src/schoolLearningPlatforms';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { theme } from '../ui/theme';

export function SchoolLearningLinks(props: { schoolId: string; schoolName?: string }) {
  const entry = getSchoolLearningEntry(props.schoolId, props.schoolName);
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function open(url: string) {
    if (!active.current) return;
    setFailed(false);
    const opened = await webBrowserOpenWithPuTronClassGate(url);
    if (active.current && !opened) setFailed(true);
  }

  if (!entry)
    return <Text style={{ color: theme.colors.muted }}>請先確認所選學校，再查看教學平台。</Text>;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
        {entry.kind === 'website'
          ? `從${entry.schoolName}官網尋找教學平台，再依校方流程登入查看作業。`
          : `前往${entry.schoolName}的教學平台，登入後查看課程與作業。`}
      </Text>
      {entry.links.map((link) => (
        <Pressable
          key={link.url}
          accessibilityRole="link"
          onPress={() => void open(link.url)}
          style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}
        >
          <Text style={{ fontWeight: '700', color: theme.colors.accent }}>{link.label}</Text>
        </Pressable>
      ))}
      {failed ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          目前無法開啟校方網站，請稍後再試。
        </Text>
      ) : null}
    </View>
  );
}
