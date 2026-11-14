import { ClubPortal } from './ClubPortal';
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card } from '../ui/components';
import { theme } from '../ui/theme';

export function ClubDirectory({
  clubs,
  onOpen,
  uid,
  schoolId,
  onRefresh,
}: {
  onRefresh?: () => void;
  uid?: string;
  schoolId?: string;
  clubs: { groupId: string; name: string }[];
  onOpen: (groupId: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
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
            if (dirty) {
              onRefresh?.();
              setDirty(false);
            }
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
        uid && schoolId ? (
          <ClubPortal uid={uid} schoolId={schoolId} onChanged={() => setDirty(true)} />
        ) : (
          <Text style={textStyle}>請先登入本校帳號。</Text>
        )
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
    </Card>
  );
}
