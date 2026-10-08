import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import {
  AIDetailScreen,
  AICard,
  AISection,
  AIRow,
  AIButton,
  AIChip,
  aiTokens,
} from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useSchool } from '../state/school';
import {
  loadCampusAnnouncements,
  loadCampusAnnouncement,
  loadCampusEvents,
  loadCampusEvent,
} from '../services/publicCampusContent';
import { safeNavigate } from '../utils/safeNavigate';
import { exportAndShareICalFile } from '../services/ical';
import type { AnnouncementCategory } from '../data/types';

type Props = {
  navigation?: {
    goBack?: () => void;
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { id?: string; announcementId?: string; eventId?: string } };
};

function useContent<T>(loader: (schoolId: string, id: string) => Promise<T>, id = '') {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id, id]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<{
    scope: string;
    value: T | null;
    error: string;
    loading: boolean;
  }>({ scope, value: null, error: '', loading: true });
  const current = () => mounted.current && activeScope.current === scope;
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, value: null, error: '', loading: true });
    try {
      const value = await loader(school.id, id);
      if (mounted.current && activeScope.current === scope && generation.current === request)
        setState({ scope, value, error: '', loading: false });
    } catch {
      if (mounted.current && activeScope.current === scope && generation.current === request)
        setState({
          scope,
          value: null,
          error: '目前無法讀取，請確認網路連線後重試。',
          loading: false,
        });
    }
  }, [loader, school.id, id, scope]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [reload]);
  return {
    ...(state.scope === scope ? state : { value: null, error: '', loading: true }),
    reload,
    current,
    scope,
  };
}

const categoryNames: Record<AnnouncementCategory, string> = {
  general: '校園',
  academic: '教務',
  event: '活動',
  emergency: '緊急',
  system: '系統',
};

function dateLabel(value?: string) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '時間尚未公布';
}

function ReadState({
  loading,
  error,
  empty,
  reload,
}: {
  loading: boolean;
  error: string;
  empty: string;
  reload: () => Promise<void>;
}) {
  return (
    <AICard title={loading ? '正在讀取' : error ? '無法讀取資料' : empty}>
      {!loading ? (
        <View style={{ gap: 12 }}>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
          <AIButton label={error ? '重新讀取' : '更新資料'} onPress={() => void reload()} />
        </View>
      ) : null}
    </AICard>
  );
}

export function CampusAnnouncementsScreen({ navigation }: Props) {
  const content = useContent(loadCampusAnnouncements);
  const [category, setCategory] = useState<AnnouncementCategory | 'all'>('all');
  const rows = content.value ?? [];
  const visible = rows.filter((row) => category === 'all' || row.category === category);
  return (
    <AIDetailScreen
      title="公告"
      subtitle="查看學校發布的最新消息。"
      onBack={() => navigation?.goBack?.()}
    >
      {content.loading || content.error || !rows.length ? (
        <ReadState {...content} empty="目前沒有公告" />
      ) : (
        <>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, margin: aiTokens.space.md }}
          >
            <AIChip
              label={`全部 ${rows.length}`}
              active={category === 'all'}
              onPress={() => setCategory('all')}
            />
            {(Object.keys(categoryNames) as AnnouncementCategory[])
              .filter((key) => rows.some((row) => row.category === key))
              .map((key) => (
                <AIChip
                  key={key}
                  label={categoryNames[key]}
                  active={category === key}
                  onPress={() => setCategory(key)}
                />
              ))}
          </View>
          <AISection title="學校公告" subtitle="最近發布的 100 則以內">
            {visible.length ? (
              visible.map((row) => (
                <AIRow
                  key={row.id}
                  title={row.title}
                  subtitle={[row.source, dateLabel(row.publishedAt)].filter(Boolean).join(' · ')}
                  tag={row.pinned ? '置頂' : undefined}
                  onPress={() => {
                    if (content.current()) safeNavigate(navigation, '公告詳情', { id: row.id });
                  }}
                />
              ))
            ) : (
              <AICard title="這個分類目前沒有公告">{null}</AICard>
            )}
          </AISection>
          <AIButton
            label="更新公告"
            variant="ghost"
            style={{ margin: aiTokens.space.md }}
            onPress={() => void content.reload()}
          />
        </>
      )}
    </AIDetailScreen>
  );
}

export function CampusAnnouncementDetailScreen({ navigation, route }: Props) {
  const id = route?.params?.id ?? route?.params?.announcementId ?? '';
  const content = useContent(loadCampusAnnouncement, id);
  const announcement = content.value;
  const [actionError, setActionError] = useState<{ scope: string; text: string } | null>(null);
  const openAttachment = async (url: string) => {
    if (!content.current()) return;
    setActionError(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (content.current())
        setActionError({ scope: content.scope, text: '無法開啟附件，請稍後重試。' });
    }
  };
  return (
    <AIDetailScreen title="公告詳情" onBack={() => navigation?.goBack?.()}>
      {content.loading || content.error || !announcement ? (
        <ReadState {...content} empty="找不到這則公告，可能已移除或不屬於目前學校。" />
      ) : (
        <>
          <AICard title={announcement.title}>
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              {[announcement.source, dateLabel(announcement.publishedAt)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </AICard>
          <AICard title="公告內容">
            <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
              {announcement.body || '此公告沒有提供內文。'}
            </Text>
          </AICard>
          {announcement.attachments?.length ? (
            <AISection title="附件">
              {announcement.attachments.map((attachment) => (
                <AIRow
                  key={attachment.id}
                  title={attachment.name}
                  onPress={() => void openAttachment(attachment.url)}
                />
              ))}
            </AISection>
          ) : null}
          {actionError?.scope === content.scope ? (
            <AICard>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {actionError.text}
              </Text>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}

export function CampusEventsScreen({ navigation }: Props) {
  const content = useContent(loadCampusEvents);
  const [period, setPeriod] = useState<'all' | 'upcoming' | 'past'>('all');
  const rows = content.value ?? [];
  const now = Date.now();
  const visible = rows.filter(
    (row) =>
      period === 'all' ||
      (row.startsAt &&
        (period === 'upcoming'
          ? new Date(row.startsAt).getTime() >= now
          : new Date(row.startsAt).getTime() < now)),
  );
  return (
    <AIDetailScreen
      title="活動"
      subtitle="查看時間、地點與主辦單位資訊。"
      onBack={() => navigation?.goBack?.()}
    >
      {content.loading || content.error || !rows.length ? (
        <ReadState {...content} empty="目前沒有活動資訊" />
      ) : (
        <>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, margin: aiTokens.space.md }}
          >
            <AIChip label="全部" active={period === 'all'} onPress={() => setPeriod('all')} />
            <AIChip
              label="未來活動"
              active={period === 'upcoming'}
              onPress={() => setPeriod('upcoming')}
            />
            <AIChip label="過往活動" active={period === 'past'} onPress={() => setPeriod('past')} />
          </View>
          <AISection title="學校活動" subtitle="最多顯示 100 場活動">
            {visible.length ? (
              visible.map((row) => (
                <AIRow
                  key={row.id}
                  title={row.title}
                  subtitle={[dateLabel(row.startsAt), row.location].filter(Boolean).join(' · ')}
                  onPress={() => {
                    if (content.current()) safeNavigate(navigation, '活動詳情', { id: row.id });
                  }}
                />
              ))
            ) : (
              <AICard title="這個時段目前沒有活動">{null}</AICard>
            )}
          </AISection>
          <AIButton
            label="更新活動"
            variant="ghost"
            style={{ margin: aiTokens.space.md }}
            onPress={() => void content.reload()}
          />
        </>
      )}
    </AIDetailScreen>
  );
}

export function CampusEventDetailScreen({ navigation, route }: Props) {
  const id = route?.params?.id ?? route?.params?.eventId ?? '';
  const content = useContent(loadCampusEvent, id);
  const event = content.value;
  const actionLock = useRef(false);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ scope: string; text: string } | null>(null);
  const run = async (action: 'share' | 'calendar') => {
    if (!event || !content.current() || actionLock.current) return;
    actionLock.current = true;
    setBusyScope(content.scope);
    setActionError(null);
    try {
      if (action === 'share') {
        await Share.share({
          title: event.title,
          message: [
            event.title,
            dateLabel(event.startsAt),
            event.location,
            event.organizer,
            event.description,
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } else {
        if (!content.current() || !event.startsAt) return;
        const startDate = new Date(event.startsAt);
        const endDate = event.endsAt ? new Date(event.endsAt) : undefined;
        if (!Number.isFinite(startDate.getTime())) return;
        await exportAndShareICalFile(
          [
            {
              id: `campus-event-${event.schoolId}-${event.id}`,
              title: event.title,
              description: event.description,
              location: event.location,
              startDate,
              endDate: endDate && endDate > startDate ? endDate : undefined,
            },
          ],
          'campus-event.ics',
          'Campus One 活動',
        );
      }
    } catch {
      if (content.current())
        setActionError({
          scope: content.scope,
          text:
            action === 'share'
              ? '無法開啟分享，請稍後重試。'
              : '無法匯出行事曆，請確認裝置支援檔案分享後重試。',
        });
    } finally {
      actionLock.current = false;
      if (content.current()) setBusyScope(null);
    }
  };
  return (
    <AIDetailScreen title="活動詳情" onBack={() => navigation?.goBack?.()}>
      {content.loading || content.error || !event ? (
        <ReadState {...content} empty="找不到這場活動，可能已移除或不屬於目前學校。" />
      ) : (
        <>
          <AICard title={event.title}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: aiTokens.text, lineHeight: 22 }}>
                {dateLabel(event.startsAt)}
                {event.endsAt ? ` 至 ${dateLabel(event.endsAt)}` : ''}
              </Text>
              <Text style={{ color: aiTokens.muted }}>地點：{event.location || '尚未公布'}</Text>
              <Text style={{ color: aiTokens.muted }}>主辦：{event.organizer || '尚未公布'}</Text>
              {event.fee != null ? (
                <Text style={{ color: aiTokens.muted }}>
                  費用：{event.fee === 0 ? '免費' : `NT$ ${event.fee}`}
                </Text>
              ) : null}
            </View>
          </AICard>
          <AICard title="活動介紹">
            <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
              {event.description || '主辦單位尚未提供活動介紹。'}
            </Text>
          </AICard>
          <AICard title="報名方式">
            <View style={{ gap: 8 }}>
              {event.registrationDeadline ? (
                <Text style={{ color: aiTokens.text }}>
                  報名截止：{dateLabel(event.registrationDeadline)}
                </Text>
              ) : null}
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                請依活動介紹中的方式向主辦單位報名。目前此頁提供活動資訊，不受理報名或付款。
              </Text>
            </View>
          </AICard>
          <AICard title="安排參加">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                將活動分享給朋友，或匯出檔案後加入自己的行事曆。加入行事曆不代表完成報名。
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AIButton
                  label="分享活動"
                  disabled={busyScope === content.scope}
                  onPress={() => void run('share')}
                />
                <AIButton
                  label="匯出行事曆"
                  variant="ghost"
                  disabled={busyScope === content.scope || !event.startsAt}
                  onPress={() => void run('calendar')}
                />
              </View>
            </View>
          </AICard>
          {actionError?.scope === content.scope ? (
            <AICard>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {actionError.text}
              </Text>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}
