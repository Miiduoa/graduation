/* eslint-disable */
import { NextClassLiveActivitySetting } from '../widgets/NextClassLiveActivitySetting';
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useTabPanelScroll } from '../hooks/useTabPanelScroll';
import { isFeatureEnabled } from '../services/release';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type WidgetSize = 'small' | 'medium' | 'large';
type WidgetStatus = 'native' | 'preview';
/** 語意色票鍵：於 render 時從即時 theme 取值，不在模組載入時固定。 */
type WidgetTone = 'accent' | 'success' | 'warning' | 'info' | 'social' | 'danger';

type Widget = {
  id: string;
  name: string;
  description: string;
  sizes: WidgetSize[];
  icon: string;
  tone: WidgetTone;
  status: WidgetStatus;
};

const WIDGETS: Widget[] = [
  {
    id: 'todaySchedule',
    name: '今日課表',
    description: '顯示今天的課程安排',
    sizes: ['small', 'medium', 'large'],
    icon: 'calendar-outline',
    tone: 'accent',
    status: 'native',
  },
  {
    id: 'nextClass',
    name: '下一堂課',
    description: '顯示即將開始的課程',
    sizes: ['small', 'medium'],
    icon: 'alarm-outline',
    tone: 'accent',
    status: 'native',
  },
  {
    id: 'busArrival',
    name: '公車到站',
    description: '即時校車到站資訊',
    sizes: ['small', 'medium'],
    icon: 'bus-outline',
    tone: 'success',
    status: 'native',
  },
  {
    id: 'announcement',
    name: '校園公告',
    description: '顯示最新公告與未讀數',
    sizes: ['medium', 'large'],
    icon: 'megaphone-outline',
    tone: 'warning',
    status: 'native',
  },
  {
    id: 'cafeteriaMenu',
    name: '餐廳菜單',
    description: '顯示今日推薦菜色',
    sizes: ['medium'],
    icon: 'restaurant-outline',
    tone: 'warning',
    status: 'preview',
  },
  {
    id: 'library',
    name: '圖書館',
    description: '借閱狀態與到期提醒',
    sizes: ['small', 'medium'],
    icon: 'library-outline',
    tone: 'social',
    status: 'preview',
  },
  {
    id: 'eventCountdown',
    name: '近期活動',
    description: '顯示即將舉辦的活動',
    sizes: ['medium', 'large'],
    icon: 'ticket-outline',
    tone: 'danger',
    status: 'preview',
  },
  {
    id: 'grades',
    name: '成績查詢',
    description: '快速查看最新成績',
    sizes: ['small', 'medium'],
    icon: 'school-outline',
    tone: 'info',
    status: 'preview',
  },
];

type WidgetStyles = ReturnType<typeof createStyles>;

function toneColor(widget: Widget): string {
  return theme.colors[widget.tone];
}

/** 狀態以圖示 + 文字呈現，不使用裝飾性膠囊徽章。 */
function WidgetStatusLabel({ status }: { status: WidgetStatus }) {
  const s = useThemeStyleSheet(createStyles);
  const isNative = status === 'native';
  const color = isNative ? theme.colors.success : theme.colors.warning;
  return (
    <View style={s.statusLabel}>
      <Ionicons
        name={isNative ? 'checkmark-circle-outline' : 'time-outline'}
        size={14}
        color={color}
      />
      <Text style={[s.statusText, { color }]}>{isNative ? '已整合' : '預覽中'}</Text>
    </View>
  );
}

function SmallWidget({ widget }: { widget: Widget }) {
  const s = useThemeStyleSheet(createStyles);
  const { width } = useWindowDimensions();
  const size = (width - theme.layout.screenPadding * 2 - theme.space.md) / 2;
  const color = toneColor(widget);

  return (
    <View style={[s.widgetSurface, s.smallWidget, { width: size }]}>
      <View style={s.spaceBetweenTop}>
        <Ionicons name={widget.icon as any} size={22} color={color} />
        <WidgetStatusLabel status={widget.status} />
      </View>

      <View>
        <Text style={s.widgetName}>{widget.name}</Text>
        {widget.id === 'todaySchedule' ? <Text style={s.metaText}>3 堂課，下一堂 10:20</Text> : null}
        {widget.id === 'nextClass' ? <Text style={s.metaText}>程式設計 22 分鐘後</Text> : null}
        {widget.id === 'busArrival' ? <Text style={s.metaText}>校門口站 3 分鐘後</Text> : null}
        {widget.id === 'library' ? <Text style={s.metaText}>2 本書即將到期</Text> : null}
        {widget.id === 'grades' ? <Text style={s.metaText}>GPA 3.75</Text> : null}
      </View>
    </View>
  );
}

function WidgetHeader({
  widget,
  styles: s,
  showDescription,
}: {
  widget: Widget;
  styles: WidgetStyles;
  showDescription?: boolean;
}) {
  return (
    <View style={s.widgetHeader}>
      <Ionicons name={widget.icon as any} size={22} color={toneColor(widget)} />
      <View style={s.flex}>
        <Text style={s.widgetTitle}>{widget.name}</Text>
        {showDescription ? <Text style={s.metaText}>{widget.description}</Text> : null}
      </View>
      <WidgetStatusLabel status={widget.status} />
    </View>
  );
}

function UrgentMark({ styles: s }: { styles: WidgetStyles }) {
  return (
    <View style={s.statusLabel}>
      <Ionicons name="alert-circle-outline" size={14} color={theme.colors.danger} />
      <Text style={[s.statusText, { color: theme.colors.danger }]}>重要</Text>
    </View>
  );
}

function MediumWidget({ widget }: { widget: Widget }) {
  const s = useThemeStyleSheet(createStyles);
  const color = toneColor(widget);

  return (
    <View style={[s.widgetSurface, s.widgetBody]}>
      <WidgetHeader widget={widget} styles={s} />

      {widget.id === 'todaySchedule' ? (
        <View style={s.list}>
          {[
            { time: '08:10', name: '微積分', room: '理學院 201' },
            { time: '10:20', name: '程式設計', room: '工程館 301' },
            { time: '13:10', name: '資料結構', room: '工程館 405' },
          ].map((course, index) => (
            <View key={`${widget.id}-${course.time}`} style={[s.listRow, index > 0 && s.divider]}>
              <Text style={[s.timeText, { color }]}>{course.time}</Text>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{course.name}</Text>
                <Text style={s.metaText}>{course.room}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'nextClass' ? (
        <View style={s.stack}>
          <Text style={[s.emphasis, { color }]}>22 分鐘後開始</Text>
          <Text style={s.widgetTitle}>程式設計</Text>
          <Text style={s.metaText}>10:20 - 12:10 · 工程館 301</Text>
        </View>
      ) : null}

      {widget.id === 'busArrival' ? (
        <View style={s.list}>
          {[
            { route: '校園接駁車', time: '3 分鐘', status: '即將到站' },
            { route: '高鐵接駁車', time: '15 分鐘', status: '行駛中' },
          ].map((bus, index) => (
            <View key={`${widget.id}-${bus.route}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{bus.route}</Text>
                <Text style={s.metaText}>{bus.status}</Text>
              </View>
              <Text style={[s.timeText, { color }]}>{bus.time}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'announcement' ? (
        <View style={s.list}>
          {[
            { title: '選課加退選截止提醒', source: '教務處', urgent: true },
            { title: '圖書館延長開館公告', source: '圖書館', urgent: false },
          ].map((announcement, index) => (
            <View key={`${widget.id}-${announcement.title}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <Text style={s.itemTitle} numberOfLines={1}>
                  {announcement.title}
                </Text>
                <Text style={s.metaText}>{announcement.source}</Text>
              </View>
              {announcement.urgent ? <UrgentMark styles={s} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'cafeteriaMenu' ? (
        <View style={s.list}>
          {[
            { name: '招牌滷肉飯', price: 45, tag: '熱門' },
            { name: '雞腿便當', price: 85, tag: '推薦' },
          ].map((item, index) => (
            <View key={`${widget.id}-${item.name}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{item.name}</Text>
                <Text style={s.metaText}>{item.tag}</Text>
              </View>
              <Text style={s.itemTitle}>${item.price}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'library' ? (
        <View style={s.list}>
          <View style={s.listRow}>
            <Text style={[s.metaText, s.flex]}>借閱中</Text>
            <Text style={s.itemTitle}>5 本</Text>
          </View>
          <View style={[s.listRow, s.divider]}>
            <Text style={[s.metaText, s.flex]}>即將到期</Text>
            <Text style={[s.itemTitle, { color: theme.colors.danger }]}>2 本</Text>
          </View>
        </View>
      ) : null}

      {widget.id === 'eventCountdown' ? (
        <View style={s.stack}>
          <Text style={s.itemTitle}>程式設計競賽</Text>
          <Text style={[s.emphasis, { color }]}>5 天 3 小時</Text>
          <Text style={s.metaText}>工程館國際會議廳 · 剩餘 12 名額</Text>
        </View>
      ) : null}

      {widget.id === 'grades' ? (
        <View style={s.list}>
          <View style={s.listRow}>
            <Text style={[s.metaText, s.flex]}>本學期 GPA</Text>
            <Text style={[s.emphasis, { color }]}>3.75</Text>
          </View>
          <View style={[s.listRow, s.divider]}>
            <Text style={[s.metaText, s.flex]}>最新成績</Text>
            <Text style={s.itemTitle}>資料庫系統 A</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LargeWidget({ widget }: { widget: Widget }) {
  const s = useThemeStyleSheet(createStyles);
  const color = toneColor(widget);

  return (
    <View style={[s.widgetSurface, s.widgetBody]}>
      <WidgetHeader widget={widget} styles={s} showDescription />

      {widget.id === 'todaySchedule' ? (
        <View style={s.list}>
          {[
            { time: '08:10-10:00', name: '微積分', room: '理學院 201', instructor: '王教授' },
            { time: '10:20-12:10', name: '程式設計', room: '工程館 301', instructor: '李教授' },
            { time: '13:10-15:00', name: '資料結構', room: '工程館 405', instructor: '張教授' },
            { time: '15:20-17:10', name: '演算法', room: '工程館 302', instructor: '陳教授' },
          ].map((course, index) => (
            <View key={`${widget.id}-${course.time}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <View style={s.spaceBetween}>
                  <Text style={s.itemTitle}>{course.name}</Text>
                  <Text style={[s.timeText, { color }]}>{course.time}</Text>
                </View>
                <Text style={s.metaText}>
                  {course.room} · {course.instructor}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'announcement' ? (
        <View style={s.list}>
          {[
            {
              title: '113 學年度第二學期選課公告',
              source: '教務處',
              meta: '今日更新',
              urgent: true,
            },
            { title: '宿舍門禁時段調整通知', source: '學務處', meta: '昨天 18:30', urgent: false },
            { title: '校慶活動交通管制提醒', source: '總務處', meta: '昨天 09:20', urgent: false },
          ].map((announcement, index) => (
            <View key={`${widget.id}-${announcement.title}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{announcement.title}</Text>
                <Text style={s.metaText}>
                  {announcement.source} · {announcement.meta}
                </Text>
              </View>
              {announcement.urgent ? <UrgentMark styles={s} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === 'eventCountdown' ? (
        <View style={s.list}>
          {[
            { name: '程式設計競賽', date: '2026/03/20', location: '工程館', spots: '剩餘 12 名額' },
            { name: '社團博覽會', date: '2026/03/24', location: '活動中心', spots: '免費參加' },
            { name: '職涯講座', date: '2026/03/28', location: '國際會議廳', spots: '剩餘 50 名額' },
          ].map((event, index) => (
            <View key={`${widget.id}-${event.name}`} style={[s.listRow, index > 0 && s.divider]}>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{event.name}</Text>
                <Text style={s.metaText}>
                  {event.date} · {event.location}
                </Text>
                <Text style={[s.metaText, { color }]}>{event.spots}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const WIDGET_TABS = [
  { id: 'preview', label: '預覽' },
  { id: 'instructions', label: '設定說明' },
] as const;

const SIZE_LABELS: Record<WidgetSize, string> = { small: '小', medium: '中', large: '大' };

export function WidgetPreviewScreen() {
  const s = useThemeStyleSheet(createStyles);
  const widgetsEnabled = isFeatureEnabled('widgets');
  const [selectedTab, setSelectedTab] = useState<(typeof WIDGET_TABS)[number]['id']>('preview');
  const panelScroll = useTabPanelScroll(selectedTab);
  const [selectedSize, setSelectedSize] = useState<WidgetSize>('medium');

  const filteredWidgets = useMemo(
    () => WIDGETS.filter((widget) => widget.sizes.includes(selectedSize)),
    [selectedSize],
  );
  const integratedWidgets = useMemo(
    () => WIDGETS.filter((widget) => widget.status === 'native'),
    [],
  );
  const previewWidgets = useMemo(() => WIDGETS.filter((widget) => widget.status === 'preview'), []);

  const handleAddWidget = (widget: Widget) => {
    const addSteps =
      Platform.OS === 'ios'
        ? '長按主畫面空白處 → 點擊左上角「+」→ 搜尋「校園助手」→ 選擇尺寸後加入。'
        : Platform.OS === 'android'
          ? '長按主畫面空白處 → 選擇「小工具」→ 找到「校園助手」→ 長按拖曳到主畫面。'
          : 'iOS 與 Android 都可從主畫面的小工具列表加入。';

    Alert.alert(
      widget.status === 'native' ? '加入小工具' : '預覽說明',
      widget.status === 'native'
        ? `${widget.name} 已有原生小工具版型與資料供應流程。\n\n${addSteps}\n\n若目前安裝包看不到小工具，請先完成 README 中的 iOS Widget Extension / Android Widget Provider 設定。`
        : `${widget.name} 目前可在 App 內預覽版型與資訊密度，原生主畫面版仍待接上。\n\n你可以先用本頁確認內容呈現，再安排原生 widget 整合。`,
      [{ text: '好的' }],
    );
  };

  if (!widgetsEnabled) {
    return (
      <Screen>
        <View style={[s.disabledWrap, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
          <Text accessibilityRole="header" style={s.sectionTitle}>
            小工具尚未上線
          </Text>
          <Text style={s.sectionSub}>正式版目前未開通此功能</Text>
          <Text style={s.bodyText}>
            只有完成原生 Widget 驗收與商店送審準備的學校，才會在正式版顯示小工具入口。
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.flex}>
        <SegmentedControl options={WIDGET_TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView ref={panelScroll} style={s.scroll} showsVerticalScrollIndicator={false}>
          <NextClassLiveActivitySetting />
          {selectedTab === 'preview' ? (
            <View style={[s.panel, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  小工具尺寸
                </Text>
                <View style={s.sizeRow}>
                  {(['small', 'medium', 'large'] as const).map((size) => {
                    const active = selectedSize === size;
                    return (
                      <Pressable
                        key={size}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${SIZE_LABELS[size]}尺寸`}
                        onPress={() => setSelectedSize(size)}
                        style={[s.sizeChip, active && s.sizeChipActive]}
                      >
                        <Text style={[s.sizeText, active && s.sizeTextActive]}>
                          {SIZE_LABELS[size]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  可用小工具 ({filteredWidgets.length})
                </Text>

                {selectedSize === 'small' ? (
                  <View style={s.smallGrid}>
                    {filteredWidgets.map((widget) => (
                      <Pressable
                        key={widget.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${widget.name}，${widget.description}`}
                        onPress={() => handleAddWidget(widget)}
                      >
                        <SmallWidget widget={widget} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {selectedSize === 'medium' ? (
                  <View style={s.widgetList}>
                    {filteredWidgets.map((widget) => (
                      <Pressable
                        key={widget.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${widget.name}，${widget.description}`}
                        onPress={() => handleAddWidget(widget)}
                      >
                        <MediumWidget widget={widget} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {selectedSize === 'large' ? (
                  <View style={s.widgetList}>
                    {filteredWidgets.map((widget) => (
                      <Pressable
                        key={widget.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${widget.name}，${widget.description}`}
                        onPress={() => handleAddWidget(widget)}
                      >
                        <LargeWidget widget={widget} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {selectedTab === 'instructions' ? (
            <View style={[s.panel, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  什麼是小工具？
                </Text>
                <Text style={s.bodyText}>
                  小工具是放在手機主畫面的快捷資訊卡片，不需要打開 App 就能快速查看重要資訊。
                </Text>
              </View>

              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  如何新增小工具？
                </Text>
                <View style={s.group}>
                  <View style={s.stepRow}>
                    <Text style={s.stepNumber}>1</Text>
                    <View style={s.flex}>
                      <Text style={s.itemTitle}>iOS</Text>
                      <Text style={s.stepText}>
                        長按主畫面空白處 → 點擊左上角「+」→ 搜尋「校園助手」→ 選擇小工具尺寸 → 新增
                      </Text>
                    </View>
                  </View>
                  <View style={[s.stepRow, s.divider]}>
                    <Text style={s.stepNumber}>2</Text>
                    <View style={s.flex}>
                      <Text style={s.itemTitle}>Android</Text>
                      <Text style={s.stepText}>
                        長按主畫面空白處 → 選擇「小工具」→ 找到「校園助手」→ 長按拖曳到主畫面
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  可用小工具一覽
                </Text>
                <View style={s.group}>
                  {WIDGETS.map((widget, index) => (
                    <View key={widget.id} style={[s.catalogRow, index > 0 && s.divider]}>
                      <Ionicons name={widget.icon as any} size={22} color={toneColor(widget)} />
                      <View style={s.flex}>
                        <Text style={s.itemTitle}>{widget.name}</Text>
                        <Text style={s.metaText}>{widget.description}</Text>
                      </View>
                      <WidgetStatusLabel status={widget.status} />
                    </View>
                  ))}
                </View>
              </View>

              <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  整合狀態
                </Text>
                <View style={s.group}>
                  <View style={s.statusBlock}>
                    <View style={s.statusLabel}>
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={16}
                        color={theme.colors.success}
                      />
                      <Text style={[s.itemTitle, { color: theme.colors.success }]}>
                        已完成原生整合 ({integratedWidgets.length})
                      </Text>
                    </View>
                    <Text style={s.metaText}>
                      {integratedWidgets.map((widget) => widget.name).join('、')}
                    </Text>
                  </View>

                  <View style={[s.statusBlock, s.divider]}>
                    <View style={s.statusLabel}>
                      <Ionicons name="time-outline" size={16} color={theme.colors.warning} />
                      <Text style={[s.itemTitle, { color: theme.colors.warning }]}>
                        預覽與資料模型已完成 ({previewWidgets.length})
                      </Text>
                    </View>
                    <Text style={s.metaText}>
                      {previewWidgets.map((widget) => widget.name).join('、')}
                    </Text>
                  </View>

                  <View style={[s.statusBlock, s.divider]}>
                    <Text style={s.metaText}>
                      小工具要真正出現在主畫面，仍需跟著 iOS / Android 原生 target
                      一起建置；本頁主要用來確認版型與資訊優先順序。
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1 },
    scroll: { flex: 1, marginTop: theme.space.md },
    panel: { gap: theme.layout.sectionGap, paddingTop: theme.space.md },
    section: { gap: theme.space.sm },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
      fontWeight: '700',
    },
    sectionSub: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
    bodyText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },
    disabledWrap: { flex: 1, justifyContent: 'center', gap: theme.space.sm },
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    sizeRow: { flexDirection: 'row', gap: theme.space.sm },
    sizeChip: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    sizeChipActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    sizeText: { color: theme.colors.textSecondary, fontWeight: '600' },
    sizeTextActive: { color: theme.colors.text, fontWeight: '700' },
    smallGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
    widgetList: { gap: theme.space.md },
    widgetSurface: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    smallWidget: {
      aspectRatio: 1,
      padding: theme.space.md,
      justifyContent: 'space-between',
    },
    spaceBetweenTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    spaceBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.space.sm,
    },
    widgetBody: { padding: theme.space.md, gap: theme.space.sm + 4 },
    widgetHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm + 4 },
    widgetName: { color: theme.colors.text, fontWeight: '700', fontSize: 14, lineHeight: 20 },
    widgetTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 16, lineHeight: 22 },
    itemTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 14, lineHeight: 20 },
    metaText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
    timeText: { fontWeight: '700', fontSize: 12 },
    emphasis: { fontWeight: '700', fontSize: 18, lineHeight: 24 },
    stack: { gap: theme.space.xs + 2 },
    list: {},
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 2,
      paddingVertical: theme.space.sm,
    },
    statusLabel: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
    statusText: { fontSize: 12, fontWeight: '600' },
    stepRow: {
      flexDirection: 'row',
      gap: theme.space.sm + 4,
      padding: theme.space.md,
    },
    stepNumber: {
      width: 20,
      color: theme.colors.textSecondary,
      fontWeight: '700',
      fontSize: 15,
    },
    stepText: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 20 },
    catalogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 56,
      paddingVertical: theme.space.sm + 2,
      paddingHorizontal: theme.space.md,
    },
    statusBlock: { padding: theme.space.md, gap: theme.space.xs + 2 },
  });
