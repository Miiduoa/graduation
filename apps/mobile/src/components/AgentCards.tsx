import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Card {
  kind: string;
  payload: Record<string, any>;
}

export function AgentCardList({ cards }: { cards: Card[] }) {
  const navigation = useNavigation<any>();

  return (
    <>
      {cards.map((card, i) => {
        if (card.kind === 'navigate') {
          const screen = String(card.payload?.screen ?? '');
          if (!screen) return null;
          return (
            <TouchableOpacity
              key={i}
              style={styles.navigateCard}
              onPress={() => navigation.navigate(screen, card.payload?.params ?? {})}
            >
              <Text style={styles.navigateText}>📍 前往 {screen.replace('Screen', '')}</Text>
            </TouchableOpacity>
          );
        }
        if (card.kind === 'assignment_list') {
          const items: any[] = card.payload.items || [];
          return (
            <View key={i} style={styles.card}>
              <Text style={styles.cardTitle}>📋 待繳作業（{card.payload.count} 筆）</Text>
              {items.slice(0, 5).map((it, j) => (
                <Text key={j} style={styles.cardItem}>
                  • {it.title}（截止：{it.dueAt?.slice?.(0, 10) || '未知'}）
                </Text>
              ))}
            </View>
          );
        }
        if (card.kind === 'schedule_today') {
          const courses: any[] = card.payload.courses || [];
          const wd = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'][card.payload.weekday ?? 0];
          const formatPeriod = (course: any) => {
            const start = course?.periodStart;
            const end = course?.periodEnd;
            if (typeof start !== 'number' || typeof end !== 'number') return '';
            return `（第 ${start}-${end} 節）`;
          };
          return (
            <View key={i} style={styles.card}>
              <Text style={styles.cardTitle}>📅 {wd}課表</Text>
              {courses.length === 0 ? (
                <Text style={styles.cardItem}>今天沒有排課</Text>
              ) : (
                courses.map((c, j) => (
                  <Text key={j} style={styles.cardItem}>
                    • {c.courseName || c.name || '未命名課程'} ｜ {c.room || c.location || '未提供教室'}{' '}
                    {formatPeriod(c)}
                  </Text>
                ))
              )}
            </View>
          );
        }
        if (card.kind === 'grades_list') {
          const items: any[] = card.payload.items || [];
          return (
            <View key={i} style={styles.card}>
              <Text style={styles.cardTitle}>📊 成績（{card.payload.count} 筆）</Text>
              {items.slice(0, 8).map((it, j) => (
                <Text key={j} style={styles.cardItem}>
                  • {it.courseName || it.name}：{it.score ?? it.grade ?? '未登錄'}
                </Text>
              ))}
            </View>
          );
        }
        if (card.kind === 'announcements_list') {
          const items: any[] = card.payload.items || [];
          return (
            <View key={i} style={styles.card}>
              <Text style={styles.cardTitle}>📢 最新公告</Text>
              {items.map((it, j) => (
                <Text key={j} style={styles.cardItem}>
                  • {it.title}
                </Text>
              ))}
            </View>
          );
        }
        if (card.kind === 'repair_submitted') {
          return (
            <View key={i} style={[styles.card, styles.successCard]}>
              <Text style={styles.cardTitle}>✅ 報修已提交</Text>
              <Text style={styles.cardItem}>地點：{card.payload.location}</Text>
              <Text style={styles.cardItem}>編號：{card.payload.repairId}</Text>
            </View>
          );
        }
        if (card.kind === 'tool_failed') {
          return (
            <View key={i} style={[styles.card, styles.errorCard]}>
              <Text style={styles.cardTitle}>⚠️ 操作失敗</Text>
              <Text style={styles.cardItem}>{card.payload.errorMessage}</Text>
            </View>
          );
        }
        return null;
      })}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginHorizontal: 4,
  },
  successCard: { backgroundColor: '#E6F7EC' },
  errorCard: { backgroundColor: '#FFF0F0' },
  navigateCard: {
    backgroundColor: '#E8F0FE',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    alignItems: 'center',
  },
  cardTitle: { fontWeight: '700', fontSize: 14, marginBottom: 6, color: '#1A1A2E' },
  cardItem: { fontSize: 13, color: '#444', marginBottom: 2 },
  navigateText: { fontSize: 14, color: '#1967D2', fontWeight: '600' },
});

