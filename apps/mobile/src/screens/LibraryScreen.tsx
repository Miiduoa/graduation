import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import {
  AnimatedCard,
  Button,
  EmptyState,
  ListItem,
  Pill,
  Screen,
  SegmentedControl,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { useAsyncStorage } from '../hooks/useStorage';
import { buildLibraryOpacHomeUrl } from '../services/libraryOpacClient';
import { buildLibraryBookDetailUrl, type OpacSearchHit } from '../services/libraryOpacSearchClient';
import {
  BORROW_PRIVILEGES,
  GAESIA_LIBRARY_INFO,
  OPENING_HOURS,
  STUDY_ROOMS,
  getBorrowPrivilege,
  getLibraryOpenStatus,
  type StudyRoom,
} from '../data/puLibraryData';
import { LibraryOpacPanel } from './LibraryOpacPanel';

type LibraryTab = 'search' | 'loans' | 'reservations' | 'info';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

type BorrowedBook = {
  id: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  coverUrl?: string;
  dataType?: string;
  availability?: string;
  officialUrl: string;
};

type LocalLoan = {
  id: string;
  book: BorrowedBook;
  borrowedAt: string;
  dueAt: string;
  status: 'active' | 'overdue';
};

type LocalReservation = {
  id: string;
  room: StudyRoom;
  date: string;
  time: string;
  status: 'confirmed';
};

const TAB_OPTIONS: { id: LibraryTab; label: string }[] = [
  { id: 'search', label: '查詢' },
  { id: 'loans', label: '借閱' },
  { id: 'reservations', label: '預約' },
  { id: 'info', label: '資訊' },
];

const DEFAULT_ROLE = 'undergraduate' as const;
const RESERVABLE_ROOMS = STUDY_ROOMS.filter((room) => room.requiresReservation).slice(0, 8);
const LOCAL_LOANS_STORAGE_KEY = '@pu.library.localLoans.v1';
const LOCAL_RESERVATIONS_STORAGE_KEY = '@pu.library.localReservations.v1';
const EMPTY_LOANS: LocalLoan[] = [];
const EMPTY_RESERVATIONS: LocalReservation[] = [];

export function LibraryScreen() {
  const [activeTab, setActiveTab] = useState<LibraryTab>('search');
  const [officialQuery, setOfficialQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loans, setLoans] = useAsyncStorage<LocalLoan[]>(LOCAL_LOANS_STORAGE_KEY, {
    defaultValue: EMPTY_LOANS,
  });
  const [reservations, setReservations] = useAsyncStorage<LocalReservation[]>(
    LOCAL_RESERVATIONS_STORAGE_KEY,
    {
      defaultValue: EMPTY_RESERVATIONS,
    },
  );
  const privilege = useMemo(() => getBorrowPrivilege(DEFAULT_ROLE), []);

  useEffect(() => {
    analytics.logScreenView('Library');
  }, []);

  const openStatus = getLibraryOpenStatus();
  const borrowedSids = useMemo(() => new Set(loans.map((loan) => loan.book.id)), [loans]);
  const overdueCount = useMemo(
    () => loans.filter((loan) => loan.status === 'overdue').length,
    [loans],
  );
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 350);
  }, []);

  const openUrl = useCallback((url: string) => {
    void WebBrowser.openBrowserAsync(url);
  }, []);

  const borrowFromHit = useCallback(
    (hit: OpacSearchHit) => {
      if (!hit.sid) {
        Alert.alert('無法加入借閱', '這筆官方資料缺少書目代碼，請改用官方頁面確認。');
        return;
      }
      if (borrowedSids.has(hit.sid)) {
        Alert.alert('已在借閱紀錄中', '這本書已經加入本地借閱紀錄。');
        return;
      }
      if (loans.length >= privilege.bookLimit) {
        Alert.alert('已達本地借閱上限', `${privilege.label}目前上限為 ${privilege.bookLimit} 冊。`);
        return;
      }

      const today = new Date();
      const book = borrowedBookFromHit(hit);
      const nextLoan: LocalLoan = {
        id: `loan-${Date.now()}-${hit.sid}`,
        book,
        borrowedAt: formatDate(today),
        dueAt: formatDate(addDays(today, privilege.bookDays)),
        status: 'active',
      };

      void setLoans((prev) => [nextLoan, ...prev]);
      Alert.alert('已加入本地借閱', `${book.title} 已加入借閱紀錄；實際借閱仍以官方系統為準。`);
    },
    [
      borrowedSids,
      loans.length,
      privilege.bookDays,
      privilege.bookLimit,
      privilege.label,
      setLoans,
    ],
  );

  const renewLoan = useCallback(
    (loanId: string) => {
      void setLoans((prev) =>
        prev.map((loan) =>
          loan.id === loanId
            ? {
                ...loan,
                dueAt: formatDate(addDays(parseLocalDate(loan.dueAt), 14)),
                status: 'active',
              }
            : loan,
        ),
      );
      Alert.alert('已更新本地到期日', '續借流程目前只更新 App 內開發資料。');
    },
    [setLoans],
  );

  const returnLoan = useCallback(
    (loanId: string) => {
      void setLoans((prev) => prev.filter((loan) => loan.id !== loanId));
    },
    [setLoans],
  );

  const reserveRoom = useCallback(
    (room: StudyRoom) => {
      const nextReservation: LocalReservation = {
        id: `reservation-${Date.now()}-${room.id}`,
        room,
        date: formatDate(addDays(new Date(), 1)),
        time: '10:00-12:00',
        status: 'confirmed',
      };

      void setReservations((prev) => [nextReservation, ...prev]);
      Alert.alert('已建立本地預約', '預約資料目前保留在 App 內，用於本地開發測試。');
    },
    [setReservations],
  );

  const cancelReservation = useCallback(
    (reservationId: string) => {
      void setReservations((prev) => prev.filter((item) => item.id !== reservationId));
    },
    [setReservations],
  );

  return (
    <Screen>
      <View style={{ flex: 1, gap: theme.space.xs }}>
        <CompactLibraryHeader
          openStatus={openStatus}
          loanCount={loans.length}
          bookLimit={privilege.bookLimit}
          activeTab={activeTab}
          onOpenLoans={() => setActiveTab('loans')}
          onOpenOfficial={() => openUrl(buildLibraryOpacHomeUrl())}
        />

        <SegmentedControl
          options={TAB_OPTIONS}
          selected={activeTab}
          onChange={(tab) => setActiveTab(tab as LibraryTab)}
        />

        {activeTab === 'search' ? (
          <SearchBorrowWorkspace
            query={officialQuery}
            onQueryChange={setOfficialQuery}
            borrowedSids={borrowedSids}
            onBorrowHit={borrowFromHit}
          />
        ) : (
          <ScrollView
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={theme.colors.accent}
              />
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              gap: theme.space.md,
              paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
            }}
          >
            {activeTab === 'loans' ? (
              <LoansSection
                loans={loans}
                privilegeLabel={privilege.label}
                bookLimit={privilege.bookLimit}
                overdueCount={overdueCount}
                onRenew={renewLoan}
                onReturn={returnLoan}
                onOpenOfficial={(url) => openUrl(url)}
                onGoSearch={() => setActiveTab('search')}
              />
            ) : null}

            {activeTab === 'reservations' ? (
              <ReservationSection
                reservations={reservations}
                onReserve={reserveRoom}
                onCancel={cancelReservation}
              />
            ) : null}

            {activeTab === 'info' ? <OfficialInfoSection onOpenUrl={openUrl} /> : null}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

function CompactLibraryHeader(props: {
  openStatus: ReturnType<typeof getLibraryOpenStatus>;
  loanCount: number;
  bookLimit: number;
  activeTab: LibraryTab;
  onOpenLoans: () => void;
  onOpenOfficial: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.sm,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>圖書館</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
          {props.openStatus.closesAt
            ? `${props.openStatus.message} · ${props.openStatus.closesAt}`
            : props.openStatus.message}
        </Text>
      </View>
      <Button
        text={`${props.loanCount}/${props.bookLimit}`}
        icon="book-outline"
        size="small"
        kind={props.activeTab === 'loans' ? 'primary' : 'secondary'}
        onPress={props.onOpenLoans}
      />
      <Button text="OPAC" icon="open-outline" size="small" onPress={props.onOpenOfficial} />
    </View>
  );
}

function SearchBorrowWorkspace(props: {
  query: string;
  onQueryChange: (query: string) => void;
  borrowedSids: Set<string>;
  onBorrowHit: (item: OpacSearchHit) => void;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <LibraryOpacPanel
        variant="fullscreen"
        query={props.query}
        onQueryChange={props.onQueryChange}
        borrowedSids={props.borrowedSids}
        onBorrowHit={props.onBorrowHit}
        bottomInset={theme.space.md}
      />
    </View>
  );
}

function LoansSection(props: {
  loans: LocalLoan[];
  privilegeLabel: string;
  bookLimit: number;
  overdueCount: number;
  onRenew: (loanId: string) => void;
  onReturn: (loanId: string) => void;
  onOpenOfficial: (url: string) => void;
  onGoSearch: () => void;
}) {
  return (
    <>
      <NoticeBox
        icon="construct-outline"
        title="本地借書開發流程"
        text="借閱紀錄現在只會從官方查詢結果加入；這裡仍是本地開發資料，不會寫入學校正式借閱系統。"
      />

      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        <StatTile label="目前借閱" value={`${props.loans.length}`} icon="book-outline" />
        <StatTile label="借閱上限" value={`${props.bookLimit}`} icon="speedometer-outline" />
        <StatTile
          label="逾期"
          value={`${props.overdueCount}`}
          icon="alert-circle-outline"
          color={props.overdueCount > 0 ? theme.colors.danger : theme.colors.success}
        />
      </View>

      <AnimatedCard
        title="本地借閱紀錄"
        subtitle={`${props.privilegeLabel}開發資料，實際紀錄仍需串接學校借閱系統。`}
      >
        {props.loans.length === 0 ? (
          <EmptyState
            variant="default"
            icon="book-outline"
            title="目前沒有借閱紀錄"
            subtitle="先到「查詢借書」搜尋官方館藏，再從結果按借書。"
            actionText="前往查詢"
            onAction={props.onGoSearch}
          />
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {props.loans.map((loan) => (
              <LoanRow
                key={loan.id}
                loan={loan}
                onRenew={() => props.onRenew(loan.id)}
                onReturn={() => props.onReturn(loan.id)}
                onOpenOfficial={() => props.onOpenOfficial(loan.book.officialUrl)}
              />
            ))}
          </View>
        )}
      </AnimatedCard>
    </>
  );
}

function ReservationSection(props: {
  reservations: LocalReservation[];
  onReserve: (room: StudyRoom) => void;
  onCancel: (reservationId: string) => void;
}) {
  return (
    <>
      <NoticeBox
        icon="calendar-outline"
        title="本地預約開發流程"
        text="空間預約維持本地開發；正式版再串接學校預約 API，避免把假資料混進官方館藏查詢。"
      />

      <AnimatedCard title="我的本地預約">
        {props.reservations.length === 0 ? (
          <EmptyState
            variant="default"
            icon="calendar-clear-outline"
            title="尚未建立本地預約"
            subtitle="可從下方空間清單建立測試預約。"
          />
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {props.reservations.map((reservation) => (
              <ReservationRow
                key={reservation.id}
                reservation={reservation}
                onCancel={() => props.onCancel(reservation.id)}
              />
            ))}
          </View>
        )}
      </AnimatedCard>

      <AnimatedCard title="可預約空間" subtitle="本地開發清單，空間規則依館方公告調整。" delay={80}>
        <View style={{ gap: theme.space.sm }}>
          {RESERVABLE_ROOMS.map((room) => (
            <RoomCard key={room.id} room={room} onReserve={() => props.onReserve(room)} />
          ))}
        </View>
      </AnimatedCard>
    </>
  );
}

function OfficialInfoSection(props: { onOpenUrl: (url: string) => void }) {
  return (
    <>
      <AnimatedCard title="官方資訊">
        <View style={{ gap: theme.space.sm }}>
          <InfoLine label="名稱" value={GAESIA_LIBRARY_INFO.name} />
          <InfoLine label="地址" value={GAESIA_LIBRARY_INFO.address} />
          <InfoLine label="電話" value={GAESIA_LIBRARY_INFO.phone} />
          <InfoLine label="信箱" value={GAESIA_LIBRARY_INFO.email} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
          <Button
            text="官方網站"
            icon="globe-outline"
            kind="primary"
            onPress={() => props.onOpenUrl(GAESIA_LIBRARY_INFO.website)}
          />
          <Button
            text="官方館藏"
            icon="search-outline"
            kind="secondary"
            onPress={() => props.onOpenUrl(GAESIA_LIBRARY_INFO.opac)}
          />
        </View>
      </AnimatedCard>

      <AnimatedCard
        title="開放時間"
        subtitle="App 內顯示的服務時間應以館方最新公告為準。"
        delay={80}
      >
        <View style={{ gap: theme.space.sm }}>
          {OPENING_HOURS.map((item) => (
            <InfoLine
              key={item.dayType}
              label={item.label}
              value={item.isOpen ? `${item.open}-${item.close}` : '休館'}
            />
          ))}
        </View>
      </AnimatedCard>

      <AnimatedCard
        title="借閱規則摘要"
        subtitle="正式規則請以圖書館公告與借閱系統為準。"
        delay={120}
      >
        <View style={{ gap: theme.space.sm }}>
          {BORROW_PRIVILEGES.slice(0, 6).map((item) => (
            <View
              key={item.role}
              style={{
                paddingVertical: theme.space.sm,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                gap: 4,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{item.label}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                圖書 {item.bookLimit} 冊 / {item.bookDays} 天；預約 {item.reserveLimit} 冊；續借{' '}
                {item.renewTimes} 次
              </Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      <AnimatedCard title="外部資源" delay={160}>
        <ListItem
          title="電子資源整合查詢"
          subtitle={GAESIA_LIBRARY_INFO.jumper}
          icon="albums-outline"
          rightIcon="open-outline"
          onPress={() => props.onOpenUrl(GAESIA_LIBRARY_INFO.jumper)}
        />
        <ListItem
          title="HyRead 電子書"
          subtitle={GAESIA_LIBRARY_INFO.hyreadEbook}
          icon="reader-outline"
          rightIcon="open-outline"
          onPress={() => props.onOpenUrl(GAESIA_LIBRARY_INFO.hyreadEbook)}
        />
      </AnimatedCard>
    </>
  );
}

function NoticeBox(props: { icon: IconName; title: string; text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.space.sm,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.accentSoft,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}22`,
      }}
    >
      <Ionicons name={props.icon} size={20} color={theme.colors.accent} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '800' }}>{props.title}</Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          {props.text}
        </Text>
      </View>
    </View>
  );
}

function StatTile(props: { label: string; value: string; icon: IconName; color?: string }) {
  const color = props.color ?? theme.colors.accent;
  return (
    <View
      style={{
        flex: 1,
        minHeight: 82,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: theme.space.sm,
      }}
    >
      <Ionicons name={props.icon} size={18} color={color} />
      <Text style={{ color, fontSize: 22, fontWeight: '800' }}>{props.value}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{props.label}</Text>
    </View>
  );
}

function LoanCover(props: { uri?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [props.uri]);

  if (!props.uri || failed) {
    return (
      <View
        style={{
          width: 58,
          height: 80,
          borderRadius: 8,
          backgroundColor: theme.colors.surface3,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="book-outline" size={22} color={theme.colors.muted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: props.uri }}
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={{
        width: 58,
        height: 80,
        borderRadius: 8,
        backgroundColor: theme.colors.surface3,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    />
  );
}

function LoanRow(props: {
  loan: LocalLoan;
  onRenew: () => void;
  onReturn: () => void;
  onOpenOfficial: () => void;
}) {
  const isOverdue = props.loan.status === 'overdue';
  return (
    <View
      style={{
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: isOverdue ? theme.colors.danger : theme.colors.border,
        backgroundColor: theme.colors.surface2,
        gap: theme.space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'flex-start' }}>
        <LoanCover uri={props.loan.book.coverUrl} />
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}
            numberOfLines={3}
          >
            {props.loan.book.title}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }} numberOfLines={2}>
            {[props.loan.book.author, props.loan.book.publisher, props.loan.book.year]
              .filter(Boolean)
              .join(' · ') || '—'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pill text={props.loan.book.dataType || '官方書目'} kind="muted" size="sm" />
            <Pill
              text={isOverdue ? '逾期' : '借閱中'}
              kind={isOverdue ? 'danger' : 'success'}
              size="sm"
            />
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            借出 {props.loan.borrowedAt} · 到期 {props.loan.dueAt}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
        <Button text="續借" icon="refresh-outline" size="small" onPress={props.onRenew} />
        <Button text="還書" icon="return-down-back-outline" size="small" onPress={props.onReturn} />
        <Button
          text="官方資料"
          icon="open-outline"
          kind="secondary"
          size="small"
          onPress={props.onOpenOfficial}
        />
      </View>
    </View>
  );
}

function ReservationRow(props: { reservation: LocalReservation; onCancel: () => void }) {
  return (
    <View
      style={{
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        gap: theme.space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md }}>
        <Ionicons name="calendar-outline" size={22} color={theme.colors.accent} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '800' }}>
            {props.reservation.room.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            {props.reservation.date} · {props.reservation.time}
          </Text>
        </View>
        <Pill text="已預約" kind="success" size="sm" />
      </View>
      <Button text="取消本地預約" icon="close-outline" size="small" onPress={props.onCancel} />
    </View>
  );
}

function RoomCard(props: { room: StudyRoom; onReserve: () => void }) {
  const features = getRoomFeatures(props.room);
  return (
    <View
      style={{
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        gap: theme.space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={roomIcon(props.room.type)} size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800' }}>
            {props.room.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            {props.room.floor} · {props.room.capacity} 人 · 單次 {props.room.maxHoursPerSession}{' '}
            小時
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
            {features.map((feature) => (
              <FeatureBadge key={feature.label} icon={feature.icon} label={feature.label} />
            ))}
          </View>
        </View>
      </View>
      <Button
        text="建立本地預約"
        icon="calendar-outline"
        kind="primary"
        size="small"
        onPress={props.onReserve}
      />
    </View>
  );
}

function FeatureBadge(props: { icon: IconName; label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Ionicons name={props.icon} size={12} color={theme.colors.accent} />
      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
        {props.label}
      </Text>
    </View>
  );
}

function InfoLine(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md }}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{props.label}</Text>
      <Text
        style={{
          flex: 1,
          color: theme.colors.text,
          fontSize: 13,
          fontWeight: '700',
          textAlign: 'right',
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

function borrowedBookFromHit(hit: OpacSearchHit): BorrowedBook {
  return {
    id: hit.sid,
    title: hit.title || '（無題名）',
    author: hit.author || '',
    publisher: hit.publisher || '',
    year: hit.year || '',
    coverUrl: hit.coverUrl,
    dataType: hit.dataType,
    availability: hit.availability,
    officialUrl: buildLibraryBookDetailUrl(hit.sid),
  };
}

function getRoomFeatures(room: StudyRoom): { icon: IconName; label: string }[] {
  const features: { icon: IconName; label: string }[] = [];
  if (room.hasWhiteboard) features.push({ icon: 'create-outline', label: '白板' });
  if (room.hasProjector) features.push({ icon: 'easel-outline', label: '投影' });
  if (room.hasScreen) features.push({ icon: 'tv-outline', label: '螢幕' });
  if (room.hasOutlet) features.push({ icon: 'flash-outline', label: '插座' });
  return features;
}

function roomIcon(type: StudyRoom['type']): IconName {
  switch (type) {
    case 'research':
      return 'person-outline';
    case 'av_room':
      return 'videocam-outline';
    case 'seminar':
      return 'people-circle-outline';
    case 'discussion':
    default:
      return 'people-outline';
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default LibraryScreen;
