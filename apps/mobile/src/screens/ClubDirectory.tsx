import { clubSummaryEnabled } from '../services/clubSummary';
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card } from '../ui/components';
import { theme } from '../ui/theme';

export function ClubDirectory({
  clubs,
  onOpen,
}: {
  clubs: { groupId: string; name: string }[];
  onOpen: (groupId: string) => void;
}) {
  const [segment, setSegment] = useState<'mine' | 'discover'>('mine');
  const [search, setSearch] = useState('');
  const visible = clubs.filter((club) =>
    club.name.toLocaleLowerCase('zh-TW').includes(search.trim().toLocaleLowerCase('zh-TW')),
  );
  const textStyle = { color: theme.colors.text, lineHeight: 22 };
  return (
    <Card title="社團" subtitle="生活 › 社團">
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button
          text="我的社團"
          kind={segment === 'mine' ? 'primary' : undefined}
          onPress={() => {
            setSegment('mine');
            setSearch('');
          }}
        />
        <Button
          text="找社團"
          kind={segment === 'discover' ? 'primary' : undefined}
          onPress={() => {
            setSegment('discover');
            setSearch('');
          }}
        />
      </View>
      <TextInput
        accessibilityLabel={segment === 'mine' ? '搜尋我的社團' : '搜尋學校社團'}
        value={search}
        onChangeText={setSearch}
        placeholder="輸入社團名稱"
        placeholderTextColor={theme.colors.muted}
        style={{
          color: theme.colors.text,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
        }}
      />
      {segment === 'discover' ? (
        <>
          <Text style={textStyle}>學校還沒提供社團名單。</Text>
          <Text style={textStyle}>
            尚未串接課外組核可名單，因此這裡不列出一般群組，也不提供入社或申請。
          </Text>
        </>
      ) : !clubs.length ? (
        <Text style={textStyle}>還沒加入社團，可以到「找社團」看看。</Text>
      ) : !visible.length ? (
        <Text style={textStyle}>沒有符合條件的結果</Text>
      ) : (
        visible.map((club) => (
          <View key={club.groupId} style={{ paddingVertical: 12, gap: 8 }}>
            <Text style={textStyle}>{club.name}</Text>
            <Text style={textStyle}>已加入 · 下一場活動尚未串接 · 未讀公告數未提供</Text>
            <Button text={`查看社團：${club.name}`} onPress={() => onOpen(club.groupId)} />
          </View>
        ))
      )}
      <Text style={textStyle}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </Text>
      {!clubSummaryEnabled() && <Text style={textStyle}>這所學校還沒開放社團管理。</Text>}
    </Card>
  );
}
