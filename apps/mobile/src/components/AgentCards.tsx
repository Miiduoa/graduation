import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export interface AgentCard {
  kind:
    | 'navigate'
    | 'assignment_list'
    | 'schedule_today'
    | 'grades_list'
    | 'announcements_list'
    | 'repair_submitted'
    | 'repair_list'
    | 'order_submitted'
    | 'tool_failed';
  payload: Record<string, any>;
}

export function AgentCardList({ cards }: { cards: AgentCard[] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <View style={styles.listWrapper}>
      {cards.map((card, i) => (
        <AgentCardItem key={`${card.kind}-${i}`} card={card} />
      ))}
    </View>
  );
}

function AgentCardItem({ card }: { card: AgentCard }) {
  switch (card.kind) {
    case 'navigate':
      return <NavigateCard payload={card.payload} />;
    case 'assignment_list':
      return <AssignmentListCard payload={card.payload} />;
    case 'schedule_today':
      return <ScheduleTodayCard payload={card.payload} />;
    case 'grades_list':
      return <GradesListCard payload={card.payload} />;
    case 'announcements_list':
      return <AnnouncementsCard payload={card.payload} />;
    case 'repair_submitted':
      return <RepairSubmittedCard payload={card.payload} />;
    case 'repair_list':
      return <RepairListCard payload={card.payload} />;
    case 'order_submitted':
      return <OrderSubmittedCard payload={card.payload} />;
    case 'tool_failed':
      return <ToolFailedCard payload={card.payload} />;
    default:
      return null;
  }
}

function NavigateCard({ payload }: { payload: any }) {
  const nav = useNavigation<any>();
  const screenLabel = String(payload.screen || '')
    .replace('Screen', '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
  return (
    <TouchableOpacity
      style={styles.navigateCard}
      onPress={() => nav.navigate(payload.screen, payload.params || {})}
      activeOpacity={0.7}
    >
      <Text style={styles.navigateIcon}>📍</Text>
      <View style={styles.navigateTextWrapper}>
        <Text style={styles.navigateTitle}>前往{screenLabel}</Text>
        {payload.reason ? <Text style={styles.navigateReason}>{payload.reason}</Text> : null}
      </View>
      <Text style={styles.navigateChevron}>›</Text>
    </TouchableOpacity>
  );
}

function AssignmentListCard({ payload }: { payload: any }) {
  const items: any[] = payload.items || [];
  return (
    <View style={styles.card}>
      <CardHeader icon="📋" title={`待繳作業（${payload.count ?? items.length} 筆）`} />
      {items.length === 0 ? (
        <Text style={styles.emptyText}>目前沒有待繳作業，繼續加油！</Text>
      ) : (
        items.slice(0, 6).map((it, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.dot}>•</Text>
            <View style={styles.listRowContent}>
              <Text style={styles.listRowTitle}>{it.title || '未知作業'}</Text>
              <Text style={styles.listRowMeta}>
                截止：{it.dueAt ? it.dueAt.slice(0, 10) : '未知'}
                {it.courseName ? ` ${it.courseName}` : ''}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const WEEKDAY_ZH = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const PERIOD_TIME: Record<number, string> = {
  1: '08:10',
  2: '09:10',
  3: '10:10',
  4: '11:10',
  5: '12:10',
  6: '13:10',
  7: '14:10',
  8: '15:10',
  9: '16:10',
  10: '17:10',
  11: '18:30',
  12: '19:20',
  13: '20:10',
};

function ScheduleTodayCard({ payload }: { payload: any }) {
  const courses: any[] = payload.courses || [];
  const today = (new Date().getDay() + 6) % 7;
  const wd = WEEKDAY_ZH[payload.weekday ?? today] ?? '今天';

  return (
    <View style={styles.card}>
      <CardHeader icon="📅" title={`${wd}課表`} />
      {courses.length === 0 ? (
        <Text style={styles.emptyText}>今天沒有排課，好好休息！</Text>
      ) : (
        courses.map((c, i) => {
          const startStr = PERIOD_TIME[c.periodStart] ?? `第 ${c.periodStart} 節`;
          const endStr = PERIOD_TIME[c.periodEnd] ?? `第 ${c.periodEnd} 節`;
          return (
            <View key={i} style={styles.scheduleRow}>
              <View style={styles.scheduleTime}>
                <Text style={styles.scheduleTimeText}>{startStr}</Text>
                <Text style={styles.scheduleTimeSep}>｜</Text>
                <Text style={styles.scheduleTimeText}>{endStr}</Text>
              </View>
              <View style={styles.scheduleCourse}>
                <Text style={styles.scheduleCourseName}>{c.courseName || '課程'}</Text>
                {c.room ? <Text style={styles.scheduleCourseRoom}>📍 {c.room}</Text> : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function GradesListCard({ payload }: { payload: any }) {
  const items: any[] = payload.items || [];
  return (
    <View style={styles.card}>
      <CardHeader icon="📊" title={`成績（${payload.count ?? items.length} 筆）`} />
      {items.length === 0 ? (
        <Text style={styles.emptyText}>目前查無成績資料。</Text>
      ) : (
        items.slice(0, 8).map((it, i) => {
          const score = it.score ?? it.grade ?? '未登錄';
          const name = it.courseName || it.name || '課程';
          const isPassing = typeof score === 'number' ? score >= 60 : null;
          return (
            <View key={i} style={styles.gradeRow}>
              <Text style={styles.gradeCourseName} numberOfLines={1}>
                {name}
              </Text>
              <Text
                style={[
                  styles.gradeScore,
                  isPassing === false && styles.gradeScoreFail,
                  isPassing === true && styles.gradeScorePass,
                ]}
              >
                {score}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

function AnnouncementsCard({ payload }: { payload: any }) {
  const items: any[] = payload.items || [];
  return (
    <View style={styles.card}>
      <CardHeader icon="📢" title={`最新公告（${payload.count ?? items.length} 則）`} />
      {items.length === 0 ? (
        <Text style={styles.emptyText}>目前沒有最新公告。</Text>
      ) : (
        items.slice(0, 5).map((it, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.dot}>•</Text>
            <View style={styles.listRowContent}>
              <Text style={styles.listRowTitle}>{it.title || '公告'}</Text>
              {it.publishedAt ? (
                <Text style={styles.listRowMeta}>{String(it.publishedAt).slice(0, 10)}</Text>
              ) : null}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function RepairSubmittedCard({ payload }: { payload: any }) {
  const nav = useNavigation<any>();
  return (
    <View style={[styles.card, styles.successCard]}>
      <CardHeader icon="✅" title="宿舍報修已提交" color="#1B5E20" />
      <InfoRow label="地點" value={payload.location || payload.dormitory || '—'} />
      <InfoRow label="類別" value={payload.category || '—'} />
      <InfoRow label="編號" value={payload.repairId || payload.requestId || '—'} />
      <TouchableOpacity style={styles.actionButton} onPress={() => nav.navigate('DormitoryScreen')}>
        <Text style={styles.actionButtonText}>查看報修紀錄</Text>
      </TouchableOpacity>
    </View>
  );
}

function RepairListCard({ payload }: { payload: any }) {
  const items: any[] = payload.items || [];
  const STATUS_ZH: Record<string, string> = {
    pending: '待處理',
    in_progress: '處理中',
    resolved: '已完成',
    cancelled: '已取消',
  };
  return (
    <View style={styles.card}>
      <CardHeader icon="🔧" title={`報修紀錄（${payload.count ?? items.length} 筆）`} />
      {items.length === 0 ? (
        <Text style={styles.emptyText}>目前沒有任何報修紀錄。</Text>
      ) : (
        items.slice(0, 5).map((it, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.dot}>•</Text>
            <View style={styles.listRowContent}>
              <Text style={styles.listRowTitle}>{it.category || '報修'}</Text>
              <Text style={styles.listRowMeta}>
                {STATUS_ZH[it.status] || it.status || '未知'}
                {it.dormitory ? ` ${it.dormitory}` : ''}
                {it.room ? ` ${it.room}` : ''}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function OrderSubmittedCard({ payload }: { payload: any }) {
  const nav = useNavigation<any>();
  return (
    <View style={[styles.card, styles.successCard]}>
      <CardHeader icon="✅" title="下單成功" color="#1B5E20" />
      <InfoRow label="餐廳" value={payload.cafeteria || payload.restaurantId || '—'} />
      <InfoRow label="金額" value={payload.total ? `NT$${payload.total}` : '—'} />
      <InfoRow label="訂單編號" value={payload.orderId || '—'} />
      <TouchableOpacity style={styles.actionButton} onPress={() => nav.navigate('CafeteriaScreen')}>
        <Text style={styles.actionButtonText}>查看訂單</Text>
      </TouchableOpacity>
    </View>
  );
}

function ToolFailedCard({ payload }: { payload: any }) {
  return (
    <View style={[styles.card, styles.errorCard]}>
      <CardHeader icon="⚠️" title="操作失敗" color="#B71C1C" />
      <Text style={styles.errorMessage}>{payload.errorMessage || '發生未知錯誤，請稍後再試。'}</Text>
      {payload.suggestion ? <Text style={styles.errorSuggestion}>{payload.suggestion}</Text> : null}
    </View>
  );
}

function CardHeader({
  icon,
  title,
  color,
}: {
  icon: string;
  title: string;
  color?: string;
}) {
  return (
    <View style={styles.cardHeader}>
      <Text style={styles.cardHeaderIcon}>{icon}</Text>
      <Text style={[styles.cardHeaderTitle, color ? { color } : null]}>{title}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}：</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listWrapper: { gap: 8, marginTop: 4 },

  card: {
    backgroundColor: '#F8F9FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E0E4F4',
  },
  successCard: { backgroundColor: '#F0FBF4', borderColor: '#A5D6A7' },
  errorCard: { backgroundColor: '#FFF5F5', borderColor: '#FFCDD2' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardHeaderIcon: { fontSize: 16, marginRight: 6 },
  cardHeaderTitle: { fontSize: 14, fontWeight: '700', color: '#000000', flex: 1 },

  navigateCard: {
    backgroundColor: '#E8F0FE',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#C6DAFC',
    flexDirection: 'row',
    alignItems: 'center',
  },
  navigateIcon: { fontSize: 18, marginRight: 10 },
  navigateTextWrapper: { flex: 1 },
  navigateTitle: { fontSize: 14, fontWeight: '700', color: '#0D47A1' },
  navigateReason: { marginTop: 2, fontSize: 12, color: '#34518B' },
  navigateChevron: { fontSize: 22, color: '#5B7DBE', marginLeft: 8 },

  listRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  dot: { width: 14, color: '#4E5F8A', lineHeight: 18 },
  listRowContent: { flex: 1 },
  listRowTitle: { fontSize: 13, color: '#1E2A4A', fontWeight: '600' },
  listRowMeta: { marginTop: 2, fontSize: 12, color: '#607099' },
  emptyText: { color: '#6B789A', fontSize: 13 },

  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    marginBottom: 8,
    overflow: 'hidden',
  },
  scheduleTime: {
    minWidth: 92,
    backgroundColor: '#E5E5EA',
    paddingVertical: 9,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  scheduleTimeText: { fontSize: 12, color: '#31436F', fontWeight: '700' },
  scheduleTimeSep: { marginHorizontal: 4, color: '#8A97BC', fontSize: 12 },
  scheduleCourse: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, justifyContent: 'center' },
  scheduleCourseName: { fontSize: 13, color: '#1E2A4A', fontWeight: '700' },
  scheduleCourseRoom: { marginTop: 2, fontSize: 12, color: '#5B6789' },

  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D8DEEE',
  },
  gradeCourseName: { flex: 1, marginRight: 8, fontSize: 13, color: '#1E2A4A' },
  gradeScore: { fontSize: 13, fontWeight: '700', color: '#37456B' },
  gradeScorePass: { color: '#2E7D32' },
  gradeScoreFail: { color: '#C62828' },

  infoRow: { flexDirection: 'row', marginBottom: 6 },
  infoLabel: { width: 62, color: '#5A678D', fontSize: 13 },
  infoValue: { flex: 1, color: '#1E2A4A', fontSize: 13, fontWeight: '600' },
  actionButton: {
    marginTop: 10,
    backgroundColor: '#2E6BFF',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  errorMessage: { fontSize: 13, color: '#8E1B1B', lineHeight: 20 },
  errorSuggestion: { marginTop: 8, fontSize: 12, color: '#9C3B3B' },
});

