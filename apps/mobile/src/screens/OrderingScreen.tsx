/* eslint-disable */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Animated, RefreshControl, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  SearchBar,
  Button,
  AnimatedCard,
  SegmentedControl,
  Pill,
  LoadingState,
  ErrorState,
  Spinner,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { formatPrice, toDate } from '../utils/format';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDataSource, hasDataSource } from '../data/source';
import { isEffectivelyOnline, addToOfflineQueue } from '../services/offline';
import { analytics } from '../services/analytics';
import { aiBrain } from '../services/aiBrain';
import type {
  Cafeteria as DataCafeteria,
  MenuItem as DataMenuItem,
  Order as DataOrder,
} from '../data/types';
import { useDataSource } from '../hooks/useDataSource';
import {
  checkAllergens,
  getDietaryProfile,
  updateDietaryProfile,
  getMyPickupCode,
  type AllergenCheckResult,
  type DietaryProfile,
  type PickupCode,
} from '../services/ordering';
import { TextInput as RNTextInput } from 'react-native';

type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  image?: string;
  customizable?: boolean;
  popular?: boolean;
  waitTime: number;
};

type CafeteriaOption = DataCafeteria & {
  orderingEnabled: boolean;
  activeOperatorCount: number;
  pilotStatus: 'inactive' | 'pilot' | 'live';
};

type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';

type Order = {
  id: string;
  queueNumber: number;
  items: { menuItem: MenuItem; quantity: number; notes?: string }[];
  status: OrderStatus;
  totalPrice: number;
  estimatedTime: number;
  createdAt: Date;
  cafeteria: string;
};

type CartItem = {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
};

const MOCK_MENU: MenuItem[] = [
  {
    id: '1',
    name: '招牌滷肉飯',
    price: 45,
    category: '飯類',
    description: '嚴選豬肉滷製',
    waitTime: 5,
    popular: true,
  },
  {
    id: '2',
    name: '雞腿便當',
    price: 85,
    category: '便當',
    description: '附配菜三樣',
    waitTime: 8,
    popular: true,
  },
  { id: '3', name: '排骨便當', price: 80, category: '便當', description: '香酥排骨', waitTime: 8 },
  {
    id: '4',
    name: '炸雞排',
    price: 55,
    category: '炸物',
    description: '酥脆多汁',
    waitTime: 6,
    customizable: true,
  },
  { id: '5', name: '蛋包飯', price: 65, category: '飯類', description: '滑嫩蛋包', waitTime: 7 },
  { id: '6', name: '牛肉麵', price: 90, category: '麵類', description: '紅燒牛肉', waitTime: 10 },
  {
    id: '7',
    name: '滷味拼盤',
    price: 60,
    category: '小吃',
    description: '綜合滷味',
    waitTime: 3,
    customizable: true,
  },
  {
    id: '8',
    name: '珍珠奶茶',
    price: 35,
    category: '飲料',
    description: '手搖現做',
    waitTime: 3,
    popular: true,
  },
  { id: '9', name: '紅茶', price: 20, category: '飲料', waitTime: 2 },
  { id: '10', name: '冬瓜茶', price: 20, category: '飲料', waitTime: 2 },
];

const MOCK_ORDERS: Order[] = [
  {
    id: 'o1',
    queueNumber: 23,
    items: [
      { menuItem: MOCK_MENU[0], quantity: 1 },
      { menuItem: MOCK_MENU[7], quantity: 2 },
    ],
    status: 'preparing',
    totalPrice: 115,
    estimatedTime: 5,
    createdAt: new Date(Date.now() - 10 * 60000),
    cafeteria: '一餐',
  },
  {
    id: 'o2',
    queueNumber: 18,
    items: [{ menuItem: MOCK_MENU[1], quantity: 1 }],
    status: 'ready',
    totalPrice: 85,
    estimatedTime: 0,
    createdAt: new Date(Date.now() - 20 * 60000),
    cafeteria: '一餐',
  },
];

function getStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return '等待確認';
    case 'confirmed':
      return '已接單';
    case 'preparing':
      return '製作中';
    case 'ready':
      return '可取餐';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function getStatusColor(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return theme.colors.muted;
    case 'confirmed':
      return '#5856D6';
    case 'preparing':
      return '#FF9500';
    case 'ready':
      return theme.colors.success;
    case 'completed':
      return theme.colors.accent;
    case 'cancelled':
      return theme.colors.danger;
    default:
      return theme.colors.muted;
  }
}

function normalizeOrderText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function OrderingScreen(props: any) {
  const nav = props?.navigation;
  const initialCafeteriaName = props?.route?.params?.cafeteria ?? null;
  const initialCafeteriaId = props?.route?.params?.cafeteriaId ?? null;
  const initialMenuItemId =
    typeof props?.route?.params?.menuItemId === 'string' ? props.route.params.menuItemId : null;
  const initialItemName =
    typeof props?.route?.params?.itemName === 'string' ? props.route.params.itemName : null;
  const initialQuantity =
    typeof props?.route?.params?.quantity === 'number'
      ? Math.max(1, props.route.params.quantity)
      : 1;
  const initialNote =
    typeof props?.route?.params?.note === 'string' ? props.route.params.note : undefined;
  const initialTab =
    typeof props?.route?.params?.initialTab === 'number' &&
    props.route.params.initialTab >= 0 &&
    props.route.params.initialTab <= 2
      ? props.route.params.initialTab
      : 0;
  const aiPrefill = props?.route?.params?.aiPrefill === true;

  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cafeterias, setCafeterias] = useState<CafeteriaOption[]>([]);
  const [selectedCafeteriaId, setSelectedCafeteriaId] = useState<string | null>(initialCafeteriaId);
  const [selectedCafeteriaName, setSelectedCafeteriaName] = useState<string | null>(
    initialCafeteriaName,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [pickupCodeViewer, setPickupCodeViewer] = useState<{
    open: boolean;
    code: PickupCode | null;
    orderQueue: number | null;
    vendorName: string;
  }>({ open: false, code: null, orderQueue: null, vendorName: '' });
  const [dietaryModal, setDietaryModal] = useState<{
    open: boolean;
    profile: DietaryProfile | null;
    allergenInput: string;
    dislikeInput: string;
  }>({ open: false, profile: null, allergenInput: '', dislikeInput: '' });

  const previousCafeteriaKeyRef = useRef<string | null>(null);
  const aiPrefillKeyRef = useRef<string | null>(null);

  const TABS = ['菜單', '購物車', '我的訂單'];

  const selectedCafeteria = useMemo(() => {
    if (selectedCafeteriaId) {
      const byId = cafeterias.find((row) => row.id === selectedCafeteriaId);
      if (byId) return byId;
    }
    if (selectedCafeteriaName) {
      return cafeterias.find((row) => row.name === selectedCafeteriaName) ?? null;
    }
    return cafeterias[0] ?? null;
  }, [cafeterias, selectedCafeteriaId, selectedCafeteriaName]);

  const currentCafeteriaName = selectedCafeteria?.name ?? selectedCafeteriaName ?? '餐廳';
  const orderingEnabled = Boolean(
    selectedCafeteria &&
    selectedCafeteria.orderingEnabled &&
    selectedCafeteria.activeOperatorCount > 0 &&
    selectedCafeteria.pilotStatus !== 'inactive',
  );
  const orderingDisabledMessage = '店家尚未開通接單';

  useEffect(() => {
    if (initialCafeteriaId) {
      setSelectedCafeteriaId(initialCafeteriaId);
    }
    if (initialCafeteriaName) {
      setSelectedCafeteriaName(initialCafeteriaName);
    }
    setSelectedTab(initialTab);
  }, [initialCafeteriaId, initialCafeteriaName, initialTab]);

  const loadMenu = useCallback(async () => {
    if (!school?.id) return;

    setLoading(true);
    try {
      const [cafeteriaRows, dataMenus] = await Promise.all([
        ds.listCafeterias(school.id).catch(() => []),
        ds.listMenus(school.id).catch(() => []),
      ]);

      const normalizedCafeterias: CafeteriaOption[] = cafeteriaRows.map((row) => ({
        ...row,
        merchantId: row.merchantId ?? row.id,
        orderingEnabled: row.orderingEnabled === true,
        activeOperatorCount:
          typeof row.activeOperatorCount === 'number' ? row.activeOperatorCount : 0,
        pilotStatus:
          row.pilotStatus === 'pilot' || row.pilotStatus === 'live' ? row.pilotStatus : 'inactive',
      }));
      setCafeterias(normalizedCafeterias);

      const resolvedCafeteria =
        (selectedCafeteriaId
          ? normalizedCafeterias.find((row) => row.id === selectedCafeteriaId)
          : null) ??
        (selectedCafeteriaName
          ? normalizedCafeterias.find((row) => row.name === selectedCafeteriaName)
          : null) ??
        normalizedCafeterias[0] ??
        null;

      if (resolvedCafeteria) {
        setSelectedCafeteriaId(resolvedCafeteria.id);
        setSelectedCafeteriaName(resolvedCafeteria.name);
      }

      if (dataMenus && dataMenus.length > 0) {
        const converted: MenuItem[] = dataMenus
          .filter((m: DataMenuItem) => {
            if (resolvedCafeteria?.id && m.cafeteriaId) {
              if (m.cafeteriaId === resolvedCafeteria.id) return true;
              if (resolvedCafeteria?.name && m.cafeteria === resolvedCafeteria.name) return true;
              return false;
            }
            if (resolvedCafeteria?.name) {
              return m.cafeteria === resolvedCafeteria.name;
            }
            return true;
          })
          .map((m: DataMenuItem) => ({
            id: m.id,
            name: m.name,
            price: m.price ?? 0,
            category: m.category ?? '其他',
            description: m.description,
            image: m.imageUrl,
            customizable: m.customizable ?? false,
            popular: (m as any).popular ?? false,
            waitTime: (m as any).waitTime ?? 5,
          }));
        if (converted.length > 0) {
          setMenuItems(converted);
        } else if (resolvedCafeteria) {
          setMenuItems([]);
        }
      } else {
        // No data from DataSource, use mock as fallback
        setMenuItems(MOCK_MENU);
      }
    } catch (error) {
      console.warn('Failed to load menu from DataSource, using mock data:', error);
      setMenuItems(MOCK_MENU);
    } finally {
      setLoading(false);
    }
  }, [ds, school?.id, selectedCafeteriaId, selectedCafeteriaName]);

  const loadOrders = useCallback(async () => {
    if (!auth.user?.uid || !school?.id) {
      setOrders([]);
      return;
    }

    setLoadingOrders(true);
    try {
      const dataOrders = await ds.listOrders(auth.user.uid, undefined, school.id);
      const filteredOrders = (dataOrders ?? []).filter((o: DataOrder) => {
        if (selectedCafeteria?.id && o.cafeteriaId) {
          return o.cafeteriaId === selectedCafeteria.id;
        }
        if (selectedCafeteria?.name) {
          return o.cafeteria === selectedCafeteria.name;
        }
        return true;
      });
      if (filteredOrders.length > 0) {
        const converted: Order[] = filteredOrders.map((o: DataOrder) => ({
          id: o.id,
          queueNumber: (o as any).queueNumber ?? Math.floor(Math.random() * 50) + 1,
          items: (o.items ?? []).map((item: any) => ({
            menuItem: menuItems.find((m) => m.id === item.menuItemId) ?? {
              id: item.menuItemId,
              name: item.name ?? '未知餐點',
              price: item.price ?? 0,
              category: '其他',
              waitTime: 5,
            },
            quantity: item.quantity,
            notes: item.notes,
          })),
          status: o.status as OrderStatus,
          totalPrice: o.totalAmount ?? o.total ?? 0,
          estimatedTime: (o as any).estimatedTime ?? 10,
          createdAt: toDate(o.createdAt) ?? new Date(),
          cafeteria: (o as any).cafeteria ?? currentCafeteriaName,
        }));
        setOrders(converted);
      } else {
        setOrders([]);
      }
    } catch (error) {
      console.warn('Failed to load orders from DataSource, using mock data:', error);
      setOrders(MOCK_ORDERS);
    } finally {
      setLoadingOrders(false);
    }
  }, [
    ds,
    auth.user?.uid,
    school?.id,
    menuItems,
    selectedCafeteria?.id,
    selectedCafeteria?.name,
    currentCafeteriaName,
  ]);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    if (selectedTab === 2) {
      loadOrders();
    }
  }, [selectedTab, loadOrders]);

  useEffect(() => {
    const nextKey = selectedCafeteria?.id ?? selectedCafeteria?.name ?? null;
    const previousKey = previousCafeteriaKeyRef.current;
    if (previousKey && nextKey && previousKey !== nextKey) {
      setCart([]);
    }
    previousCafeteriaKeyRef.current = nextKey;
  }, [selectedCafeteria?.id, selectedCafeteria?.name]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMenu();
    if (selectedTab === 2) {
      await loadOrders();
    }
    setRefreshing(false);
  }, [loadMenu, loadOrders, selectedTab]);

  const categories = useMemo(() => {
    const cats = ['全部', ...new Set(menuItems.map((m) => m.category))];
    return cats;
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    let items = menuItems;
    if (selectedCategory !== '全部') {
      items = items.filter((m) => m.category === selectedCategory);
    }
    if (searchQuery) {
      items = items.filter(
        (m) =>
          m.name.includes(searchQuery) ||
          m.description?.includes(searchQuery) ||
          m.category.includes(searchQuery),
      );
    }
    return items;
  }, [menuItems, selectedCategory, searchQuery]);

  useEffect(() => {
    if (!aiPrefill || menuItems.length === 0) return;

    const prefillKey = `${selectedCafeteria?.id ?? selectedCafeteriaName ?? ''}:${initialMenuItemId ?? ''}:${initialItemName ?? ''}:${initialQuantity}:${initialNote ?? ''}`;
    if (aiPrefillKeyRef.current === prefillKey) return;

    const normalizedItemName = normalizeOrderText(initialItemName);
    const target = menuItems.find((item) => {
      if (initialMenuItemId && item.id === initialMenuItemId) return true;
      const itemName = normalizeOrderText(item.name);
      return (
        Boolean(normalizedItemName) &&
        (itemName.includes(normalizedItemName) || normalizedItemName.includes(itemName))
      );
    });

    aiPrefillKeyRef.current = prefillKey;
    if (!target) {
      if (initialItemName) setSearchQuery(initialItemName);
      setSelectedTab(0);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((entry) => entry.menuItem.id === target.id);
      if (existing) {
        return prev.map((entry) =>
          entry.menuItem.id === target.id
            ? {
                ...entry,
                quantity: Math.max(entry.quantity, initialQuantity),
                notes: initialNote ?? entry.notes,
              }
            : entry,
        );
      }
      return [...prev, { menuItem: target, quantity: initialQuantity, notes: initialNote }];
    });
    setSelectedTab(1);
  }, [
    aiPrefill,
    initialItemName,
    initialMenuItemId,
    initialNote,
    initialQuantity,
    menuItems,
    selectedCafeteria?.id,
    selectedCafeteriaName,
  ]);

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  }, [cart]);

  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const handleAddToCart = (menuItem: MenuItem) => {
    const existing = cart.find((c) => c.menuItem.id === menuItem.id);
    if (existing) {
      setCart(
        cart.map((c) => (c.menuItem.id === menuItem.id ? { ...c, quantity: c.quantity + 1 } : c)),
      );
    } else {
      setCart([...cart, { menuItem, quantity: 1 }]);
    }
  };

  const handleUpdateQuantity = (menuItemId: string, delta: number) => {
    setCart((prev) => {
      const updated = prev
        .map((c) => (c.menuItem.id === menuItemId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0);
      return updated;
    });
  };

  const handlePlaceOrder = async () => {
    if (!selectedCafeteria || !orderingEnabled) {
      Alert.alert('無法下單', orderingDisabledMessage);
      return;
    }

    if (cart.length === 0) {
      Alert.alert('購物車是空的', '請先選擇餐點');
      return;
    }

    if (!auth.user) {
      Alert.alert('請先登入', '您需要登入才能下單。是否前往登入頁面？', [
        { text: '取消', style: 'cancel' },
        { text: '前往登入', onPress: () => nav?.navigate?.('我的') },
      ]);
      return;
    }

    const isOnline = isEffectivelyOnline();

    if (!isOnline) {
      Alert.alert('目前離線', '無法在離線狀態下下單。請連接網路後再試。', [{ text: '確定' }]);
      return;
    }

    // ===== 過敏原檢查（下單前最後防線）=====
    try {
      const dietary = await getDietaryProfile(auth.user.uid);
      const itemsForCheck = cart.map((c) => ({
        id: c.menuItem.id,
        name: c.menuItem.name,
        allergens: (c.menuItem as any).allergens ?? [],
      }));
      const allergenResult = await checkAllergens(itemsForCheck, dietary);

      if (allergenResult.severity === 'block') {
        Alert.alert(
          '過敏原警告',
          `${allergenResult.message}\n\n是否仍要繼續下單？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '我了解風險，繼續下單',
              style: 'destructive',
              onPress: () => confirmAndPlaceOrder(),
            },
          ],
        );
        return;
      }
      if (allergenResult.severity === 'warn') {
        Alert.alert('提醒', allergenResult.message, [
          { text: '返回修改', style: 'cancel' },
          { text: '繼續下單', onPress: () => confirmAndPlaceOrder() },
        ]);
        return;
      }
    } catch (err) {
      console.warn('[OrderingScreen] allergen check failed:', err);
    }

    confirmAndPlaceOrder();
  };

  const confirmAndPlaceOrder = () => {
    Alert.alert('確認訂單', `共 ${cartCount} 項商品，總計 $${cartTotal}`, [
      { text: '取消', style: 'cancel' },
      {
        text: '確認下單',
        onPress: async () => {
          setSubmittingOrder(true);
          try {
            const orderData = {
              userId: auth.user!.uid,
              schoolId: school.id,
              cafeteriaId: selectedCafeteria.id,
              merchantId: selectedCafeteria.merchantId ?? selectedCafeteria.id,
              cafeteria: selectedCafeteria.name,
              items: cart.map((c) => ({
                menuItemId: c.menuItem.id,
                name: c.menuItem.name,
                price: c.menuItem.price,
                quantity: c.quantity,
                notes: c.notes,
              })),
              totalAmount: cartTotal,
              status: 'pending' as const,
            };

            const createdOrder = await ds.createOrder(orderData);

            analytics.logEvent('place_order', {
              order_id: createdOrder?.id,
              total_amount: cartTotal,
              item_count: cartCount,
              cafeteria: selectedCafeteria.name,
              cafeteria_id: selectedCafeteria.id,
            });

            try {
              const { emitCafeteriaOrderPlaced } = await import('../services/campusEventBus');
              emitCafeteriaOrderPlaced({
                userId: auth.user!.uid,
                vendorId: selectedCafeteria.merchantId ?? selectedCafeteria.id,
                total: cartTotal,
              });
            } catch {
              /* optional bus */
            }

            try {
              aiBrain.reportToolOutcome(
                'order_meal',
                {
                  cafeteria: selectedCafeteria.name,
                  cafeteriaId: selectedCafeteria.id,
                  itemCount: cartCount,
                  totalAmount: cartTotal,
                  itemNames: cart.map((c) => c.menuItem.name).slice(0, 5).join('、'),
                },
                'success',
                undefined,
                `在「${selectedCafeteria.name}」訂購 ${cartCount} 項餐點`,
              );
              for (const item of cart) {
                aiBrain.observe({
                  kind: 'observation',
                  tool: 'order_meal',
                  args: {
                    cafeteria: selectedCafeteria.name,
                    itemName: item.menuItem.name,
                    keyword: item.menuItem.name,
                    quantity: item.quantity,
                  },
                  outcome: 'success',
                  summary: `偏好菜色：${item.menuItem.name}（${selectedCafeteria.name}）`,
                  tags: ['cafeteria', 'order_meal'],
                });
              }
            } catch (brainError) {
              console.warn('[OrderingScreen] brain.observe failed:', brainError);
            }

            // 號碼牌：優先用 Cloud Function 取得，否則退回時間戳序號（不再用 Math.random）
            let queueNumber: number = (createdOrder as any)?.queueNumber ?? 0;
            if (!queueNumber) {
              try {
                const { httpsCallable } = await import('firebase/functions');
                const { getFunctionsInstance } = await import('../firebase');
                const fn = httpsCallable<
                  { schoolId: string; vendorId: string },
                  { ok?: boolean; serial?: number }
                >(getFunctionsInstance(), 'assignQueueNumber');
                const result = await fn({
                  schoolId: school.id,
                  vendorId: selectedCafeteria.id,
                });
                if (result.data?.serial) queueNumber = result.data.serial;
              } catch {
                // fallback：每分鐘一號（demo 用，跨日不會衝突）
                const t = new Date();
                queueNumber = Math.max(1, t.getHours() * 60 + t.getMinutes() - 7 * 60);
              }
            }
            const estimatedTime = Math.max(...cart.map((c) => c.menuItem.waitTime));

            const newOrder: Order = {
              id: createdOrder?.id ?? `o${Date.now()}`,
              queueNumber,
              items: cart,
              status: 'pending',
              totalPrice: cartTotal,
              estimatedTime,
              createdAt: new Date(),
              cafeteria: selectedCafeteria.name,
            };

            setOrders([newOrder, ...orders]);
            setCart([]);
            setSelectedTab(2);

            Alert.alert(
              '訂單已送出',
              `您的號碼是 ${queueNumber}，預計等待 ${estimatedTime} 分鐘\n\n餐點準備好時會通知您。`,
            );
          } catch (error: any) {
            console.error('Failed to place order:', error);
            try {
              aiBrain.reportToolOutcome(
                'order_meal',
                {
                  cafeteria: selectedCafeteria.name,
                  cafeteriaId: selectedCafeteria.id,
                  itemCount: cartCount,
                },
                'failure',
                error?.message,
                `在「${selectedCafeteria.name}」嘗試訂購 ${cartCount} 項餐點`,
              );
            } catch (brainError) {
              console.warn('[OrderingScreen] brain.observe failed:', brainError);
            }
            Alert.alert('下單失敗', error?.message ?? '請稍後再試或聯繫店家。', [{ text: '確定' }]);
          } finally {
            setSubmittingOrder(false);
          }
        },
      },
    ]);
  };

  const handleCancelOrder = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    if (order.status === 'preparing') {
      Alert.alert('無法取消', '餐點已在製作中，無法取消訂單。\n\n如有問題請直接聯繫店家。', [
        { text: '確定' },
      ]);
      return;
    }

    Alert.alert('取消訂單', '確定要取消此訂單嗎？\n\n已付款的金額將會退回原付款方式。', [
      { text: '否', style: 'cancel' },
      {
        text: '是，取消訂單',
        style: 'destructive',
        onPress: async () => {
          try {
            await ds.cancelOrder(orderId, auth.user?.uid, school.id);

            analytics.logEvent('cancel_order', {
              order_id: orderId,
              cafeteria: currentCafeteriaName,
            });

            setOrders(
              orders.map((o) =>
                o.id === orderId ? { ...o, status: 'cancelled' as OrderStatus } : o,
              ),
            );
            Alert.alert('已取消', '訂單已取消，退款將在 3-5 個工作天內處理。');
          } catch (error: any) {
            console.error('Failed to cancel order:', error);
            Alert.alert('取消失敗', error?.message ?? '請稍後再試或聯繫店家。');
          }
        },
      },
    ]);
  };

  const activeOrders = useMemo(() => {
    return orders.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status));
  }, [orders]);

  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />
          </View>
          {cartCount > 0 && selectedTab !== 1 && (
            <Pressable
              onPress={() => setSelectedTab(1)}
              style={{
                position: 'relative',
                padding: 8,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Ionicons name="cart" size={22} color="#fff" />
              <View
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: theme.colors.danger,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{cartCount}</Text>
              </View>
            </Pressable>
          )}
        </View>

        {activeOrders.length > 0 && selectedTab !== 2 && (
          <Pressable onPress={() => setSelectedTab(2)}>
            <AnimatedCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Animated.View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: `${getStatusColor(activeOrders[0].status)}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: activeOrders[0].status === 'ready' ? pulseAnim : 1 }],
                  }}
                >
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '700',
                      color: getStatusColor(activeOrders[0].status),
                    }}
                  >
                    #{activeOrders[0].queueNumber}
                  </Text>
                </Animated.View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      訂單 {getStatusLabel(activeOrders[0].status)}
                    </Text>
                    {activeOrders[0].status === 'ready' && (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.success,
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                          可取餐
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {activeOrders[0].cafeteria} · {activeOrders[0].items.length} 項商品
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </View>
            </AnimatedCard>
          </Pressable>
        )}

        <ScrollView
          style={{ flex: 1, marginTop: 8 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {loading ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Spinner size={32} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入菜單中...</Text>
                </View>
              ) : null}

              {!loading && (
                <>
                  {cafeterias.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {cafeterias.map((row) => {
                          const selected = selectedCafeteria?.id === row.id;
                          const available =
                            row.orderingEnabled &&
                            row.activeOperatorCount > 0 &&
                            row.pilotStatus !== 'inactive';
                          return (
                            <Pressable
                              key={row.id}
                              onPress={() => {
                                setSelectedCafeteriaId(row.id);
                                setSelectedCafeteriaName(row.name);
                              }}
                              style={{
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderRadius: theme.radius.full,
                                backgroundColor: selected
                                  ? theme.colors.accent
                                  : theme.colors.surface2,
                                borderWidth: 1,
                                borderColor: selected ? theme.colors.accent : theme.colors.border,
                                opacity: available ? 1 : 0.72,
                              }}
                            >
                              <Text
                                style={{
                                  color: selected ? '#fff' : theme.colors.text,
                                  fontWeight: '700',
                                  fontSize: 13,
                                }}
                              >
                                {row.name}
                              </Text>
                              {!available && (
                                <Text
                                  style={{
                                    color: selected ? 'rgba(255,255,255,0.88)' : theme.colors.muted,
                                    fontSize: 10,
                                    marginTop: 2,
                                  }}
                                >
                                  未開通
                                </Text>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  )}

                  <AnimatedCard title={currentCafeteriaName} subtitle="線上點餐">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <Pill
                        text={
                          orderingEnabled
                            ? `接單中 · ${selectedCafeteria?.activeOperatorCount ?? 0} 位店員`
                            : orderingDisabledMessage
                        }
                        kind={orderingEnabled ? 'success' : 'warning'}
                      />
                      {selectedCafeteria?.pilotStatus && (
                        <Pill
                          text={
                            selectedCafeteria.pilotStatus === 'live'
                              ? '正式開通'
                              : selectedCafeteria.pilotStatus === 'pilot'
                                ? '試營運'
                                : '未開通'
                          }
                          kind={orderingEnabled ? 'accent' : 'default'}
                        />
                      )}
                    </View>
                    {!orderingEnabled && (
                      <Text style={{ color: theme.colors.warning, marginTop: 12, lineHeight: 20 }}>
                        店家尚未開通接單，餐點仍可瀏覽，但目前不能送出訂單。
                      </Text>
                    )}
                  </AnimatedCard>

                  <SearchBar
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="搜尋餐點"
                  />

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {categories.map((cat) => (
                        <Pressable
                          key={cat}
                          onPress={() => setSelectedCategory(cat)}
                          style={{
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            borderRadius: theme.radius.full,
                            backgroundColor:
                              selectedCategory === cat
                                ? theme.colors.accent
                                : theme.colors.surface2,
                          }}
                        >
                          <Text
                            style={{
                              color: selectedCategory === cat ? '#fff' : theme.colors.text,
                              fontWeight: '600',
                              fontSize: 13,
                            }}
                          >
                            {cat}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>

                  {filteredMenu.map((item, idx) => (
                    <AnimatedCard key={item.id} delay={idx * 30}>
                      <Pressable
                        disabled={!orderingEnabled}
                        onPress={() => handleAddToCart(item)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 14,
                          opacity: orderingEnabled ? 1 : 0.55,
                        }}
                      >
                        <View
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="restaurant" size={28} color={theme.colors.muted} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text
                              style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}
                            >
                              {item.name}
                            </Text>
                            {item.popular && (
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: theme.radius.full,
                                  backgroundColor: '#FF950020',
                                }}
                              >
                                <Text style={{ color: '#FF9500', fontSize: 9, fontWeight: '700' }}>
                                  熱門
                                </Text>
                              </View>
                            )}
                          </View>
                          {item.description && (
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {item.description}
                            </Text>
                          )}
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 8,
                              marginTop: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: theme.colors.accent,
                                fontWeight: '700',
                                fontSize: 16,
                              }}
                            >
                              ${item.price}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                              約 {item.waitTime} 分鐘
                            </Text>
                          </View>
                        </View>
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: orderingEnabled
                              ? theme.colors.accent
                              : theme.colors.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="add" size={20} color="#fff" />
                        </View>
                      </Pressable>
                    </AnimatedCard>
                  ))}
                </>
              )}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {cart.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                    <Ionicons name="cart-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      購物車是空的
                    </Text>
                    <Button
                      text="開始點餐"
                      onPress={() => setSelectedTab(0)}
                      style={{ marginTop: 20 }}
                    />
                  </View>
                </AnimatedCard>
              ) : (
                <>
                  <AnimatedCard title="購物車" subtitle={`${cartCount} 項商品`}>
                    <View style={{ gap: 12 }}>
                      {cart.map((cartItem) => (
                        <View
                          key={cartItem.menuItem.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 8,
                            gap: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.border,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                              {cartItem.menuItem.name}
                            </Text>
                            <Text
                              style={{ color: theme.colors.accent, fontSize: 14, marginTop: 2 }}
                            >
                              ${cartItem.menuItem.price}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Pressable
                              onPress={() => handleUpdateQuantity(cartItem.menuItem.id, -1)}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 16,
                                backgroundColor: theme.colors.surface2,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons name="remove" size={18} color={theme.colors.text} />
                            </Pressable>
                            <Text
                              style={{
                                color: theme.colors.text,
                                fontWeight: '700',
                                minWidth: 24,
                                textAlign: 'center',
                              }}
                            >
                              {cartItem.quantity}
                            </Text>
                            <Pressable
                              onPress={() => handleUpdateQuantity(cartItem.menuItem.id, 1)}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 16,
                                backgroundColor: theme.colors.accent,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons name="add" size={18} color="#fff" />
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </AnimatedCard>

                  <AnimatedCard title="訂單摘要" delay={100}>
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.colors.muted }}>小計</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                          ${cartTotal}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.colors.muted }}>預估等待</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                          {Math.max(...cart.map((c) => c.menuItem.waitTime))} 分鐘
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
                          總計
                        </Text>
                        <Text
                          style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 20 }}
                        >
                          ${cartTotal}
                        </Text>
                      </View>
                    </View>
                  </AnimatedCard>

                  <AnimatedCard delay={150}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="notifications" size={22} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                          到號提醒
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          餐點準備好時通知我
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => setNotificationsEnabled(!notificationsEnabled)}
                        style={{
                          width: 50,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: notificationsEnabled
                            ? theme.colors.accent
                            : theme.colors.border,
                          justifyContent: 'center',
                          padding: 2,
                        }}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: '#fff',
                            alignSelf: notificationsEnabled ? 'flex-end' : 'flex-start',
                          }}
                        />
                      </Pressable>
                    </View>
                  </AnimatedCard>

                  <Button
                    text={
                      !orderingEnabled
                        ? orderingDisabledMessage
                        : submittingOrder
                          ? '送出中...'
                          : `下單 $${cartTotal}`
                    }
                    kind="primary"
                    onPress={handlePlaceOrder}
                    disabled={submittingOrder || !orderingEnabled}
                  />
                </>
              )}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <Pressable
                onPress={async () => {
                  if (!auth.user) return;
                  const profile = await getDietaryProfile(auth.user.uid);
                  setDietaryModal({
                    open: true,
                    profile,
                    allergenInput: '',
                    dislikeInput: '',
                  });
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons name="restaurant" size={20} color={theme.colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                    飲食偏好與過敏原
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    設定後下單時會自動比對攔截
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
              </Pressable>

              {orders.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                    <Ionicons name="receipt-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      尚無訂單
                    </Text>
                    <Button
                      text="開始點餐"
                      onPress={() => setSelectedTab(0)}
                      style={{ marginTop: 20 }}
                    />
                  </View>
                </AnimatedCard>
              ) : (
                orders.map((order, idx) => (
                  <AnimatedCard key={order.id} delay={idx * 50}>
                    <View style={{ gap: 12 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View
                            style={{
                              width: 50,
                              height: 50,
                              borderRadius: 25,
                              backgroundColor: `${getStatusColor(order.status)}20`,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: '700',
                                color: getStatusColor(order.status),
                              }}
                            >
                              #{order.queueNumber}
                            </Text>
                          </View>
                          <View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                                {order.cafeteria}
                              </Text>
                              <View
                                style={{
                                  paddingHorizontal: 8,
                                  paddingVertical: 2,
                                  borderRadius: theme.radius.full,
                                  backgroundColor: `${getStatusColor(order.status)}20`,
                                }}
                              >
                                <Text
                                  style={{
                                    color: getStatusColor(order.status),
                                    fontSize: 11,
                                    fontWeight: '700',
                                  }}
                                >
                                  {getStatusLabel(order.status)}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {order.createdAt.toLocaleTimeString('zh-TW', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 18 }}
                        >
                          ${order.totalPrice}
                        </Text>
                      </View>

                      <View
                        style={{
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface,
                        }}
                      >
                        {order.items.map((item, i) => (
                          <View
                            key={i}
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              paddingVertical: 4,
                            }}
                          >
                            <Text style={{ color: theme.colors.muted }}>
                              {item.menuItem.name} x{item.quantity}
                            </Text>
                            <Text style={{ color: theme.colors.muted }}>
                              ${item.menuItem.price * item.quantity}
                            </Text>
                          </View>
                        ))}
                      </View>

                      {order.status === 'ready' && (
                        <Pressable
                          onPress={async () => {
                            const code = await getMyPickupCode(order.id);
                            setPickupCodeViewer({
                              open: true,
                              code,
                              orderQueue: order.queueNumber,
                              vendorName: order.cafeteria,
                            });
                          }}
                          style={{
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: `${theme.colors.success}15`,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <Ionicons
                            name="qr-code"
                            size={24}
                            color={theme.colors.success}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{ color: theme.colors.success, fontWeight: '700' }}
                            >
                              餐點已準備好，請前往取餐！
                            </Text>
                            <Text
                              style={{
                                color: theme.colors.success,
                                fontSize: 11,
                                marginTop: 2,
                              }}
                            >
                              點擊顯示取餐碼
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.success}
                          />
                        </Pressable>
                      )}

                      {order.status === 'confirmed' && (
                        <View
                          style={{
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: '#5856D615',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <Ionicons name="restaurant" size={24} color="#5856D6" />
                          <Text style={{ color: '#5856D6', fontWeight: '600', flex: 1 }}>
                            店家已接單，即將開始製作
                          </Text>
                        </View>
                      )}

                      {order.status === 'preparing' && (
                        <View
                          style={{
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: '#FF950015',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <Ionicons name="time" size={24} color="#FF9500" />
                          <Text style={{ color: '#FF9500', fontWeight: '600', flex: 1 }}>
                            預計 {order.estimatedTime} 分鐘後完成
                          </Text>
                        </View>
                      )}

                      {['pending', 'preparing'].includes(order.status) && (
                        <Button text="取消訂單" onPress={() => handleCancelOrder(order.id)} />
                      )}
                    </View>
                  </AnimatedCard>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* PickupCode Modal — 學生取餐時出示給店員 */}
      <Modal
        visible={pickupCodeViewer.open}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setPickupCodeViewer({ open: false, code: null, orderQueue: null, vendorName: '' })
        }
      >
        <Pressable
          onPress={() =>
            setPickupCodeViewer({ open: false, code: null, orderQueue: null, vendorName: '' })
          }
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%',
              maxWidth: 360,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: 24,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 13,
                marginBottom: 4,
              }}
            >
              {pickupCodeViewer.vendorName}
            </Text>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: 16,
                fontWeight: '700',
                marginBottom: 16,
              }}
            >
              請出示取餐碼給店員
            </Text>

            {pickupCodeViewer.code ? (
              <>
                <View
                  style={{
                    paddingVertical: 24,
                    paddingHorizontal: 16,
                    borderRadius: theme.radius.md,
                    borderWidth: 2,
                    borderColor: theme.colors.success,
                    backgroundColor: `${theme.colors.success}10`,
                    marginBottom: 16,
                    alignItems: 'center',
                    minWidth: 280,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 48,
                      fontWeight: '700',
                      color: theme.colors.success,
                      letterSpacing: 8,
                      fontFamily: 'System',
                    }}
                  >
                    {pickupCodeViewer.code.shortCode}
                  </Text>
                </View>

                {pickupCodeViewer.orderQueue != null && (
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: 22,
                      fontWeight: '700',
                      marginBottom: 4,
                    }}
                  >
                    號碼 #{pickupCodeViewer.orderQueue}
                  </Text>
                )}

                <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 16 }}>
                  有效期限：{new Date(pickupCodeViewer.code.expiresAt).toLocaleTimeString('zh-TW', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </>
            ) : (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <Ionicons name="alert-circle" size={48} color={theme.colors.warning} />
                <Text style={{ color: theme.colors.muted, marginTop: 12, textAlign: 'center' }}>
                  找不到取餐碼。請聯繫店家或重新整理。
                </Text>
              </View>
            )}

            <Pressable
              onPress={() =>
                setPickupCodeViewer({ open: false, code: null, orderQueue: null, vendorName: '' })
              }
              style={{
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
                marginTop: 8,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>關閉</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 飲食偏好設定 Modal */}
      <Modal
        visible={dietaryModal.open}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setDietaryModal({ open: false, profile: null, allergenInput: '', dislikeInput: '' })
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              paddingBottom: 36,
              maxHeight: '85%',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
                飲食偏好與過敏原
              </Text>
              <Pressable
                onPress={() =>
                  setDietaryModal({
                    open: false,
                    profile: null,
                    allergenInput: '',
                    dislikeInput: '',
                  })
                }
              >
                <Ionicons name="close" size={24} color={theme.colors.muted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 12,
                  marginBottom: 16,
                  lineHeight: 18,
                }}
              >
                嚴格過敏原會在下單前攔截，並要求二次確認；不喜歡食材則只會提醒不擋。
              </Text>

              {/* 嚴格過敏原 */}
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '700',
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                嚴格過敏原（會攔截下單）
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {(dietaryModal.profile?.allergens ?? []).map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => {
                      if (!dietaryModal.profile) return;
                      setDietaryModal((m) => ({
                        ...m,
                        profile: {
                          ...m.profile!,
                          allergens: m.profile!.allergens.filter((x) => x !== a),
                        },
                      }));
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: `${theme.colors.danger}20`,
                    }}
                  >
                    <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: '700' }}>
                      {a}
                    </Text>
                    <Ionicons name="close" size={14} color={theme.colors.danger} />
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                <RNTextInput
                  value={dietaryModal.allergenInput}
                  onChangeText={(t) =>
                    setDietaryModal((m) => ({ ...m, allergenInput: t }))
                  }
                  placeholder="輸入過敏原（如：花生）"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 8,
                    padding: 10,
                    color: theme.colors.text,
                  }}
                />
                <Pressable
                  onPress={() => {
                    const word = dietaryModal.allergenInput.trim();
                    if (!word || !dietaryModal.profile) return;
                    if (dietaryModal.profile.allergens.includes(word)) {
                      setDietaryModal((m) => ({ ...m, allergenInput: '' }));
                      return;
                    }
                    setDietaryModal((m) => ({
                      ...m,
                      allergenInput: '',
                      profile: {
                        ...m.profile!,
                        allergens: [...m.profile!.allergens, word],
                      },
                    }));
                  }}
                  style={{
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    borderRadius: 8,
                    backgroundColor: theme.colors.danger,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>新增</Text>
                </Pressable>
              </View>

              {/* 不喜歡食材 */}
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '700',
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                不喜歡食材（只提醒）
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {(dietaryModal.profile?.dislikes ?? []).map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => {
                      if (!dietaryModal.profile) return;
                      setDietaryModal((m) => ({
                        ...m,
                        profile: {
                          ...m.profile!,
                          dislikes: m.profile!.dislikes.filter((x) => x !== d),
                        },
                      }));
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontSize: 12 }}>{d}</Text>
                    <Ionicons name="close" size={14} color={theme.colors.muted} />
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                <RNTextInput
                  value={dietaryModal.dislikeInput}
                  onChangeText={(t) =>
                    setDietaryModal((m) => ({ ...m, dislikeInput: t }))
                  }
                  placeholder="輸入不喜歡的食材（如：香菜）"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 8,
                    padding: 10,
                    color: theme.colors.text,
                  }}
                />
                <Pressable
                  onPress={() => {
                    const word = dietaryModal.dislikeInput.trim();
                    if (!word || !dietaryModal.profile) return;
                    if (dietaryModal.profile.dislikes.includes(word)) {
                      setDietaryModal((m) => ({ ...m, dislikeInput: '' }));
                      return;
                    }
                    setDietaryModal((m) => ({
                      ...m,
                      dislikeInput: '',
                      profile: {
                        ...m.profile!,
                        dislikes: [...m.profile!.dislikes, word],
                      },
                    }));
                  }}
                  style={{
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    borderRadius: 8,
                    backgroundColor: theme.colors.accent,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>新增</Text>
                </Pressable>
              </View>

              {/* 飲食類型 toggle */}
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '700',
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                飲食類型
              </Text>
              {[
                { key: 'vegetarian' as const, label: '素食' },
                { key: 'vegan' as const, label: '純素' },
                { key: 'halal' as const, label: '清真 (Halal)' },
              ].map((opt) => {
                const checked = dietaryModal.profile?.[opt.key] ?? false;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      if (!dietaryModal.profile) return;
                      setDietaryModal((m) => ({
                        ...m,
                        profile: { ...m.profile!, [opt.key]: !checked },
                      }));
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 10,
                    }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? theme.colors.accent : theme.colors.muted}
                    />
                    <Text style={{ color: theme.colors.text, fontWeight: '500' }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable
                onPress={async () => {
                  if (!auth.user || !dietaryModal.profile) return;
                  await updateDietaryProfile(auth.user.uid, {
                    allergens: dietaryModal.profile.allergens,
                    dislikes: dietaryModal.profile.dislikes,
                    vegetarian: dietaryModal.profile.vegetarian,
                    vegan: dietaryModal.profile.vegan,
                    halal: dietaryModal.profile.halal,
                  });
                  Alert.alert('已儲存', '飲食偏好已更新');
                  setDietaryModal({
                    open: false,
                    profile: null,
                    allergenInput: '',
                    dislikeInput: '',
                  });
                }}
                style={{
                  marginTop: 16,
                  paddingVertical: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>儲存設定</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
