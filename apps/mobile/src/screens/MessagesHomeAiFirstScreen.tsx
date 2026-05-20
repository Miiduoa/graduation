/**
 * Campus AI-First — 訊息對話列表 V2（私訊 + 群組）
 *
 * 依 demo 角色顯示對應的私訊 / 群組，避免切角色後看到上一個角色的對話。
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIChip,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';
import { useDemoRole, type DemoRole } from '../state/demoRole';

type Filter = 'all' | 'unread' | 'private' | 'group';
type ConversationKind = 'private' | 'group';
type ConversationSection = 'pinned' | 'unread' | 'all';
type ConversationRow = {
  section: ConversationSection;
  kind: ConversationKind;
  icon: string;
  title: string;
  subtitle: string;
  tag?: string;
  tagTone?: 'danger' | 'warning' | 'success' | 'ai';
};

const ROLE_CONVERSATIONS: Record<DemoRole, ConversationRow[]> = {
  student: [
    { section: 'pinned', kind: 'private', icon: '👨‍🏫', title: '林助教', subtitle: '週三辦公室時間調整...', tag: '重要', tagTone: 'danger' },
    { section: 'unread', kind: 'group', icon: '👥', title: '程式設計社', subtitle: '陳社長：黑客松要組隊嗎', tag: '3', tagTone: 'ai' },
    { section: 'unread', kind: 'group', icon: '👥', title: '專題小組', subtitle: '王同學分享了一個檔案', tag: '1', tagTone: 'ai' },
    { section: 'unread', kind: 'private', icon: '👤', title: '陳老師', subtitle: '期末報告延長至下週五', tag: '1', tagTone: 'warning' },
    { section: 'all', kind: 'private', icon: '👤', title: '李同學', subtitle: '作業系統的範例答案我傳給你了' },
    { section: 'all', kind: 'group', icon: '👥', title: '資料庫小組', subtitle: '今晚 7 點工程館 308' },
    { section: 'all', kind: 'private', icon: '👤', title: '黃同學', subtitle: '明天約咖啡？' },
  ],
  teacher: [
    { section: 'pinned', kind: 'group', icon: '📚', title: '資料庫系統 TA 群', subtitle: '林助教：缺交名單已整理', tag: '重要', tagTone: 'danger' },
    { section: 'unread', kind: 'private', icon: '👩‍🎓', title: '顧晉瑋', subtitle: '老師，我想確認期末專題方向', tag: '2', tagTone: 'warning' },
    { section: 'unread', kind: 'private', icon: '🧑‍💻', title: '林助教', subtitle: '作業三批改進度 70%', tag: '1', tagTone: 'ai' },
    { section: 'all', kind: 'group', icon: '👥', title: '資訊管理學系教師群', subtitle: '黃主任：本週課程品保會議提醒' },
    { section: 'all', kind: 'private', icon: '🏛', title: '黃主任', subtitle: '公告送審格式請再確認' },
  ],
  ta: [
    { section: 'pinned', kind: 'group', icon: '📚', title: '資料庫系統助教台', subtitle: '待回覆求助 3 則', tag: '待辦', tagTone: 'danger' },
    { section: 'unread', kind: 'private', icon: '👩‍🎓', title: '顧晉瑋', subtitle: '鏈結串列遞迴卡關', tag: '2', tagTone: 'warning' },
    { section: 'all', kind: 'private', icon: '👨‍🏫', title: '張怡君老師', subtitle: '請先看高風險學生' },
  ],
  club_officer: [
    { section: 'pinned', kind: 'group', icon: '🎯', title: '程式設計社幹部群', subtitle: '黑客松報名最後確認', tag: '重要', tagTone: 'danger' },
    { section: 'unread', kind: 'private', icon: '👤', title: '新社員申請', subtitle: '有 2 位同學等待審核', tag: '2', tagTone: 'warning' },
    { section: 'all', kind: 'group', icon: '👥', title: '社團聯席會', subtitle: '場地借用規則更新' },
  ],
  department_head: [
    { section: 'pinned', kind: 'group', icon: '🏛', title: '系務行政群', subtitle: '待審公告 2 則', tag: '待審', tagTone: 'danger' },
    { section: 'unread', kind: 'private', icon: '👨‍🏫', title: '張怡君老師', subtitle: '公告內容已更新', tag: '1', tagTone: 'warning' },
    { section: 'all', kind: 'group', icon: '📊', title: '教學品質追蹤', subtitle: '本週課程健康度報表已產生' },
  ],
  admin: [
    { section: 'pinned', kind: 'group', icon: '🛡', title: '系統維運', subtitle: 'App Check 監控正常', tag: '系統', tagTone: 'success' },
    { section: 'unread', kind: 'private', icon: '🔧', title: '宿舍管理組', subtitle: '高優先報修待派工', tag: '1', tagTone: 'warning' },
    { section: 'all', kind: 'group', icon: '📋', title: '帳號權限審核', subtitle: '新增 1 筆校內身份申請' },
  ],
  vendor: [
    { section: 'pinned', kind: 'group', icon: '🍱', title: '靜園自助餐訂單', subtitle: '新訂單等待接單', tag: '新訂單', tagTone: 'danger' },
    { section: 'unread', kind: 'private', icon: '👩‍🎓', title: '顧晉瑋', subtitle: '請問便當幾點可以取？', tag: '1', tagTone: 'warning' },
    { section: 'all', kind: 'group', icon: '📈', title: '餐廳營運提醒', subtitle: '今日熱銷品項已更新' },
  ],
  alumni: [
    { section: 'pinned', kind: 'group', icon: '🎓', title: '校友會公告', subtitle: '週末返校活動提醒', tag: '活動', tagTone: 'ai' },
    { section: 'all', kind: 'private', icon: '🏛', title: '系辦', subtitle: '校友講座邀請確認' },
  ],
  guest: [],
};

export default function MessagesHomeAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<Filter>('all');
  const { role: demoRole, definition } = useDemoRole();
  const conversations = ROLE_CONVERSATIONS[demoRole];
  const filtered = conversations.filter((row) => {
    if (filter === 'unread') return row.section === 'unread';
    if (filter === 'private') return row.kind === 'private';
    if (filter === 'group') return row.kind === 'group';
    return true;
  });
  const counts = {
    unread: conversations.filter((row) => row.section === 'unread').length,
    private: conversations.filter((row) => row.kind === 'private').length,
    group: conversations.filter((row) => row.kind === 'group').length,
  };
  const sectionRows = (section: ConversationSection) => filtered.filter((row) => row.section === section);

  return (
    <AIDetailScreen
      title="訊息"
      subtitle={`${definition.shortLabel} · ${counts.unread} 個未讀 · ${conversations.length} 個對話`}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={
          counts.unread > 0
            ? `${definition.shortLabel}目前有 ${counts.unread} 個未讀，已依角色只顯示相關對話`
            : '目前沒有未讀訊息'
        }
        source="AI · 對話重要性"
        confidence="high"
      />

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
        }}
      >
        <AIChip label={`全部 ${conversations.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
        <AIChip
          label={counts.unread > 0 ? `未讀 ${counts.unread}` : '未讀'}
          active={filter === 'unread'}
          onPress={() => setFilter('unread')}
        />
        <AIChip label={`私訊 ${counts.private}`} active={filter === 'private'} onPress={() => setFilter('private')} />
        <AIChip label={`群組 ${counts.group}`} active={filter === 'group'} onPress={() => setFilter('group')} />
      </View>

      {(['pinned', 'unread', 'all'] as const).map((section) => {
        const rows = sectionRows(section);
        if (rows.length === 0) return null;
        const title = section === 'pinned' ? '📌 釘選' : section === 'unread' ? '未讀' : '所有對話';
        return (
          <AISection key={section} title={title}>
            {rows.map((row) => (
              <AIRow
                key={`${section}-${row.title}`}
                icon={row.icon}
                title={row.title}
                subtitle={row.subtitle}
                tag={row.tag}
                tagTone={row.tagTone}
              />
            ))}
          </AISection>
        );
      })}

      <AILegacyLink
        label="完整訊息工作台（含未讀統計、批次操作）"
        onPress={() => navigation?.navigate?.('InboxLegacy' as never)}
      />
    </AIDetailScreen>
  );
}
