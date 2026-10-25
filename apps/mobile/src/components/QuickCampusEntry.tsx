import React, { useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../state/theme';
import { getMobileQuickActions, type MobileQuickAction } from '../services/quickCampusActions';

const favoriteActions = [
  { label: '課表', phrase: '我的課表', icon: 'calendar-outline' as const },
  { label: '交作業', phrase: '我要交作業', icon: 'document-text-outline' as const },
  { label: '公車', phrase: '公車到站時間', icon: 'bus-outline' as const },
  { label: '餐廳', phrase: '校園餐廳', icon: 'restaurant-outline' as const },
];

export function QuickCampusEntry({
  signedIn,
  onOpen,
  onAsk,
}: {
  signedIn: boolean;
  onOpen: (action: MobileQuickAction) => void;
  onAsk: (question: string) => void;
}) {
  const design = useTheme();
  const { colors, radius, typography } = design;
  const [query, setQuery] = useState('');
  const phrase = query.trim();
  const suggestions = getMobileQuickActions(phrase);

  function open(action: MobileQuickAction) {
    Keyboard.dismiss();
    onOpen(action);
  }

  return (
    <View
      style={{
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 18,
        backgroundColor: colors.surface,
        padding: 16,
        gap: 13,
      }}
      accessibilityLabel="快速開始"
    >
      <View style={{ gap: 4 }}>
        <Text style={{ ...typography.h3, color: colors.text }}>想做什麼？</Text>
        <Text style={{ ...typography.bodySmall, color: colors.muted }}>
          直接說出需求，不用翻找功能。可使用鍵盤上的麥克風口述。
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bg,
          borderRadius: radius.lg,
          paddingLeft: 12,
          paddingRight: 6,
          gap: 8,
        }}
      >
        <Ionicons name="search-outline" size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="說出或輸入想做的事"
          placeholder="例如：我要交作業"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={160}
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 50,
            paddingVertical: 10,
            fontSize: 15,
            color: colors.text,
          }}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityLabel="清除快速需求"
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close-circle-outline" size={21} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {!phrase ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {favoriteActions.map((favorite) => (
            <Pressable
              key={favorite.label}
              accessibilityRole="button"
              accessibilityLabel={'直接前往' + favorite.label}
              onPress={() => {
                const action = getMobileQuickActions(favorite.phrase)[0];
                if (action) open(action);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                minHeight: 44,
                borderRadius: 999,
                paddingHorizontal: 13,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surface2 : colors.bg,
              })}
            >
              <Ionicons name={favorite.icon} size={17} color={colors.accent} />
              <Text style={{ ...typography.bodySmall, fontWeight: '600', color: colors.text }}>
                {favorite.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ gap: 9 }}>
          {suggestions.length ? (
            <>
              <Text style={{ ...typography.caption, color: colors.muted }}>建議直接開啟</Text>
              {suggestions.map((action) => (
                <Pressable
                  key={action.destination}
                  accessibilityRole="button"
                  accessibilityLabel={'前往' + action.label}
                  onPress={() => open(action)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 13,
                    gap: 10,
                    minHeight: 58,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surface3 : colors.surface2,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...typography.body, fontWeight: '600', color: colors.text }}>
                      {action.label}
                    </Text>
                    <Text style={{ ...typography.caption, color: colors.muted }}>
                      {action.description}
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" color={colors.accent} size={18} />
                </Pressable>
              ))}
            </>
          ) : (
            <Text style={{ ...typography.bodySmall, color: colors.muted }}>
              還沒有對應的捷徑。可以修改文字，或向校園助理詢問。
            </Text>
          )}
          {signedIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="將問題帶到校園助理"
              onPress={() => {
                Keyboard.dismiss();
                onAsk(phrase);
              }}
              style={{ justifyContent: 'center', alignSelf: 'flex-start', minHeight: 44 }}
            >
              <Text style={{ ...typography.bodySmall, color: colors.accent, fontWeight: '600' }}>
                問校園助理，先核對問題再送出
              </Text>
            </Pressable>
          ) : (
            <Text style={{ ...typography.caption, color: colors.muted }}>
              登入後可詢問個人課務。公開服務現在就能開啟。
            </Text>
          )}
        </View>
      )}

      <Text style={{ ...typography.caption, color: colors.muted }}>
        只會開啟服務，不會自動繳交、付款或更改資料。
      </Text>
    </View>
  );
}
