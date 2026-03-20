import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, Animated, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, SearchBar, Button, AnimatedCard, SegmentedControl, Pill, LoadingState, ErrorState, Spinner } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatPrice, toDate } from "../utils/format";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDataSource, hasDataSource } from "../data/source";
import { isEffectivelyOnline, addToOfflineQueue } from "../services/offline";
import { analytics } from "../services/analytics";
import type { MenuItem as DataMenuItem, Order as DataOrder } from "../data/types";
import { useDataSource } from "../hooks/useDataSource";

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

type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "cancelled";

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
  { id: "1", name: "招牌滷肉飯", price: 45, category: "飯類", description: "嚴選豬肉滷製", waitTime: 5, popular: true },
  { id: "2", name: "雞腿便當", price: 85, category: "便當", description: "附配菜三樣", waitTime: 8, popular: true },
  { id: "3", name: "排骨便當", price: 80, category: "便當", description: "香酥排骨", waitTime: 8 },
  { id: "4", name: "炸雞排", price: 55, category: "炸物", description: "酥脆多汁", waitTime: 6, customizable: true },
  { id: "5", name: "蛋包飯", price: 65, category: "飯類", description: "滑嫩蛋包", waitTime: 7 },
  { id: "6", name: "牛肉麵", price: 90, category: "麵類", description: "紅燒牛肉", waitTime: 10 },
  { id: "7", name: "滷味拼盤", price: 60, category: "小吃", description: "綜合滷味", waitTime: 3, customizable: true },
  { id: "8", name: "珍珠奶茶", price: 35, category: "飲料", description: "手搖現做", waitTime: 3, popular: true },
  { id: "9", name: "紅茶", price: 20, category: "飲料", waitTime: 2 },
  { id: "10", name: "冬瓜茶", price: 20, category: "飲料", waitTime: 2 },
];

const MOCK_ORDERS: Order[] = [
  {
    id: "o1",
    queueNumber: 23,
    items: [
      { menuItem: MOCK_MENU[0], quantity: 1 },
      { menuItem: MOCK_MENU[7], quantity: 2 },
    ],
    status: "preparing",
    totalPrice: 115,
    estimatedTime: 5,
    createdAt: new Date(Date.now() - 10 * 60000),
    cafeteria: "一餐",
  },
  {
    id: "o2",
    queueNumber: 18,
    items: [{ menuItem: MOCK_MENU[1], quantity: 1 }],
    status: "ready",
    totalPrice: 85,
    estimatedTime: 0,
    createdAt: new Date(Date.now() - 20 * 60000),
    cafeteria: "一餐",
  },
];

function getStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending": return "等待中";
    case "preparing": return "製作中";
    case "ready": return "可取餐";
    case "completed": return "已完成";
    case "cancelled": return "已取消";
    default: return status;
  }
}

function getStatusColor(status: OrderStatus): string {
  switch (status) {
    case "pending": return theme.colors.muted;
    case "preparing": return "#F59E0B";
    case "ready": return theme.colors.success;
    case "completed": return theme.colors.accent;
    case "cancelled": return theme.colors.danger;
    default: return theme.colors.muted;
  }
}

export function OrderingScreen(props: any) {
  const nav = props?.navigation;
  const cafeteria = props?.route?.params?.cafeteria ?? "一餐";

  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  
  const [selectedTab, setSelectedTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(MOCK_MENU);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  const TABS = ["菜單", "購物車", "我的訂單"];

  const loadMenu = useCallback(async () => {
    if (!school?.id) return;
    
    try {
      const dataMenus = await ds.listMenus(school.id);
      if (dataMenus && dataMenus.length > 0) {
        const converted: MenuItem[] = dataMenus
          .filter((m: DataMenuItem) => m.cafeteria === cafeteria || !cafeteria)
          .map((m: DataMenuItem) => ({
            id: m.id,
            name: m.name,
            price: m.price,
            category: m.category ?? "其他",
            description: m.description,
            image: m.imageUrl,
            customizable: m.customizable ?? false,
            popular: (m as any).popular ?? false,
            waitTime: (m as any).waitTime ?? 5,
          }));
        if (converted.length > 0) {
          setMenuItems(converted);
        }
      }
    } catch (error) {
      console.warn("Failed to load menu from Firebase, using mock data:", error);
    } finally {
      setLoading(false);
    }
  }, [ds, school?.id, cafeteria]);

  const loadOrders = useCallback(async () => {
    if (!auth.user?.uid || !school?.id) {
      setOrders(MOCK_ORDERS);
      return;
    }
    
    setLoadingOrders(true);
    try {
      const dataOrders = await ds.listOrders(auth.user.uid, undefined, school.id);
      if (dataOrders && dataOrders.length > 0) {
        const converted: Order[] = dataOrders.map((o: DataOrder) => ({
          id: o.id,
          queueNumber: (o as any).queueNumber ?? Math.floor(Math.random() * 50) + 1,
          items: (o.items ?? []).map((item: any) => ({
            menuItem: menuItems.find(m => m.id === item.menuItemId) ?? {
              id: item.menuItemId,
              name: item.name ?? "未知餐點",
              price: item.price ?? 0,
              category: "其他",
              waitTime: 5,
            },
            quantity: item.quantity,
            notes: item.notes,
          })),
          status: o.status as OrderStatus,
          totalPrice: o.totalAmount,
          estimatedTime: (o as any).estimatedTime ?? 10,
          createdAt: toDate(o.createdAt) ?? new Date(),
          cafeteria: (o as any).cafeteria ?? cafeteria,
        }));
        setOrders(converted);
      } else {
        setOrders([]);
      }
    } catch (error) {
      console.warn("Failed to load orders from Firebase:", error);
      setOrders(MOCK_ORDERS);
    } finally {
      setLoadingOrders(false);
    }
  }, [ds, auth.user?.uid, school?.id, menuItems, cafeteria]);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    if (selectedTab === 2) {
      loadOrders();
    }
  }, [selectedTab, loadOrders]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMenu();
    if (selectedTab === 2) {
      await loadOrders();
    }
    setRefreshing(false);
  }, [loadMenu, loadOrders, selectedTab]);

  const categories = useMemo(() => {
    const cats = ["全部", ...new Set(menuItems.map((m) => m.category))];
    return cats;
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    let items = menuItems;
    if (selectedCategory !== "全部") {
      items = items.filter((m) => m.category === selectedCategory);
    }
    if (searchQuery) {
      items = items.filter(
        (m) =>
          m.name.includes(searchQuery) ||
          m.description?.includes(searchQuery) ||
          m.category.includes(searchQuery)
      );
    }
    return items;
  }, [menuItems, selectedCategory, searchQuery]);

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
        cart.map((c) =>
          c.menuItem.id === menuItem.id ? { ...c, quantity: c.quantity + 1 } : c
        )
      );
    } else {
      setCart([...cart, { menuItem, quantity: 1 }]);
    }
  };

  const handleUpdateQuantity = (menuItemId: string, delta: number) => {
    setCart((prev) => {
      const updated = prev
        .map((c) =>
          c.menuItem.id === menuItemId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0);
      return updated;
    });
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      Alert.alert("購物車是空的", "請先選擇餐點");
      return;
    }

    if (!auth.user) {
      Alert.alert(
        "請先登入",
        "您需要登入才能下單。是否前往登入頁面？",
        [
          { text: "取消", style: "cancel" },
          { text: "前往登入", onPress: () => nav?.navigate?.("我的") },
        ]
      );
      return;
    }

    const isOnline = isEffectivelyOnline();
    
    if (!isOnline) {
      Alert.alert(
        "目前離線",
        "無法在離線狀態下下單。請連接網路後再試。",
        [{ text: "確定" }]
      );
      return;
    }

    Alert.alert(
      "確認訂單",
      `共 ${cartCount} 項商品，總計 $${cartTotal}`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認下單",
          onPress: async () => {
            setSubmittingOrder(true);
            try {
              const orderData = {
                userId: auth.user!.uid,
                schoolId: school.id,
                cafeteria,
                items: cart.map((c) => ({
                  menuItemId: c.menuItem.id,
                  name: c.menuItem.name,
                  price: c.menuItem.price,
                  quantity: c.quantity,
                  notes: c.notes,
                })),
                totalAmount: cartTotal,
                status: "pending" as const,
              };
              
              const createdOrder = await ds.createOrder(orderData);
              
              analytics.logEvent("place_order", {
                order_id: createdOrder?.id,
                total_amount: cartTotal,
                item_count: cartCount,
                cafeteria,
              });

              const queueNumber = (createdOrder as any)?.queueNumber ?? Math.floor(Math.random() * 50) + 30;
              const estimatedTime = Math.max(...cart.map((c) => c.menuItem.waitTime));
              
              const newOrder: Order = {
                id: createdOrder?.id ?? `o${Date.now()}`,
                queueNumber,
                items: cart,
                status: "pending",
                totalPrice: cartTotal,
                estimatedTime,
                createdAt: new Date(),
                cafeteria,
              };
              
              setOrders([newOrder, ...orders]);
              setCart([]);
              setSelectedTab(2);
              
              Alert.alert(
                "訂單已送出",
                `您的號碼是 ${queueNumber}，預計等待 ${estimatedTime} 分鐘\n\n餐點準備好時會通知您。`
              );
            } catch (error: any) {
              console.error("Failed to place order:", error);
              Alert.alert(
                "下單失敗",
                error?.message ?? "請稍後再試或聯繫店家。",
                [{ text: "確定" }]
              );
            } finally {
              setSubmittingOrder(false);
            }
          },
        },
      ]
    );
  };

  const handleCancelOrder = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    
    if (order.status === "preparing") {
      Alert.alert(
        "無法取消",
        "餐點已在製作中，無法取消訂單。\n\n如有問題請直接聯繫店家。",
        [{ text: "確定" }]
      );
      return;
    }
    
    Alert.alert(
      "取消訂單",
      "確定要取消此訂單嗎？\n\n已付款的金額將會退回原付款方式。",
      [
        { text: "否", style: "cancel" },
        {
          text: "是，取消訂單",
          style: "destructive",
          onPress: async () => {
            try {
              await ds.cancelOrder(orderId, auth.user?.uid, school.id);
              
              analytics.logEvent("cancel_order", {
                order_id: orderId,
                cafeteria,
              });
              
              setOrders(
                orders.map((o) => (o.id === orderId ? { ...o, status: "cancelled" as OrderStatus } : o))
              );
              Alert.alert("已取消", "訂單已取消，退款將在 3-5 個工作天內處理。");
            } catch (error: any) {
              console.error("Failed to cancel order:", error);
              Alert.alert("取消失敗", error?.message ?? "請稍後再試或聯繫店家。");
            }
          },
        },
      ]
    );
  };

  const activeOrders = useMemo(() => {
    return orders.filter((o) => ["pending", "preparing", "ready"].includes(o.status));
  }, [orders]);

  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />
          </View>
          {cartCount > 0 && selectedTab !== 1 && (
            <Pressable
              onPress={() => setSelectedTab(1)}
              style={{
                position: "relative",
                padding: 8,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Ionicons name="cart" size={22} color="#fff" />
              <View
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: theme.colors.danger,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{cartCount}</Text>
              </View>
            </Pressable>
          )}
        </View>

        {activeOrders.length > 0 && selectedTab !== 2 && (
          <Pressable onPress={() => setSelectedTab(2)}>
            <AnimatedCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Animated.View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: `${getStatusColor(activeOrders[0].status)}20`,
                    alignItems: "center",
                    justifyContent: "center",
                    transform: [{ scale: activeOrders[0].status === "ready" ? pulseAnim : 1 }],
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: "900", color: getStatusColor(activeOrders[0].status) }}>
                    #{activeOrders[0].queueNumber}
                  </Text>
                </Animated.View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                      訂單 {getStatusLabel(activeOrders[0].status)}
                    </Text>
                    {activeOrders[0].status === "ready" && (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.success,
                        }}
                      >
                        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>可取餐</Text>
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
                <View style={{ paddingVertical: 40, alignItems: "center" }}>
                  <Spinner size={32} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入菜單中...</Text>
                </View>
              ) : null}
              
              {!loading && (
                <>
                <SearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜尋餐點"
              />

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {categories.map((cat) => (
                    <Pressable
                      key={cat}
                      onPress={() => setSelectedCategory(cat)}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: theme.radius.full,
                        backgroundColor:
                          selectedCategory === cat ? theme.colors.accent : theme.colors.surface2,
                      }}
                    >
                      <Text
                        style={{
                          color: selectedCategory === cat ? "#fff" : theme.colors.text,
                          fontWeight: "600",
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
                    onPress={() => handleAddToCart(item)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="restaurant" size={28} color={theme.colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                          {item.name}
                        </Text>
                        {item.popular && (
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: "#F59E0B20",
                            }}
                          >
                            <Text style={{ color: "#F59E0B", fontSize: 9, fontWeight: "700" }}>
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 16 }}>
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
                        backgroundColor: theme.colors.accent,
                        alignItems: "center",
                        justifyContent: "center",
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
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
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
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 8,
                            gap: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.border,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                              {cartItem.menuItem.name}
                            </Text>
                            <Text style={{ color: theme.colors.accent, fontSize: 14, marginTop: 2 }}>
                              ${cartItem.menuItem.price}
                            </Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <Pressable
                              onPress={() => handleUpdateQuantity(cartItem.menuItem.id, -1)}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 16,
                                backgroundColor: theme.colors.surface2,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons name="remove" size={18} color={theme.colors.text} />
                            </Pressable>
                            <Text style={{ color: theme.colors.text, fontWeight: "700", minWidth: 24, textAlign: "center" }}>
                              {cartItem.quantity}
                            </Text>
                            <Pressable
                              onPress={() => handleUpdateQuantity(cartItem.menuItem.id, 1)}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 16,
                                backgroundColor: theme.colors.accent,
                                alignItems: "center",
                                justifyContent: "center",
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
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: theme.colors.muted }}>小計</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>${cartTotal}</Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: theme.colors.muted }}>預估等待</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                          {Math.max(...cart.map((c) => c.menuItem.waitTime))} 分鐘
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                          總計
                        </Text>
                        <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 20 }}>
                          ${cartTotal}
                        </Text>
                      </View>
                    </View>
                  </AnimatedCard>

                  <AnimatedCard delay={150}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="notifications" size={22} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>到號提醒</Text>
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
                          justifyContent: "center",
                          padding: 2,
                        }}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: "#fff",
                            alignSelf: notificationsEnabled ? "flex-end" : "flex-start",
                          }}
                        />
                      </Pressable>
                    </View>
                  </AnimatedCard>

                  <Button 
                    text={submittingOrder ? "送出中..." : `下單 $${cartTotal}`} 
                    kind="primary" 
                    onPress={handlePlaceOrder}
                    disabled={submittingOrder}
                  />
                </>
              )}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {orders.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
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
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View
                            style={{
                              width: 50,
                              height: 50,
                              borderRadius: 25,
                              backgroundColor: `${getStatusColor(order.status)}20`,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: "900",
                                color: getStatusColor(order.status),
                              }}
                            >
                              #{order.queueNumber}
                            </Text>
                          </View>
                          <View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
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
                                    fontWeight: "700",
                                  }}
                                >
                                  {getStatusLabel(order.status)}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {order.createdAt.toLocaleTimeString("zh-TW", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 18 }}>
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
                              flexDirection: "row",
                              justifyContent: "space-between",
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

                      {order.status === "ready" && (
                        <View
                          style={{
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: `${theme.colors.success}15`,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
                          <Text style={{ color: theme.colors.success, fontWeight: "700", flex: 1 }}>
                            餐點已準備好，請前往取餐！
                          </Text>
                        </View>
                      )}

                      {order.status === "preparing" && (
                        <View
                          style={{
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: "#F59E0B15",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <Ionicons name="time" size={24} color="#F59E0B" />
                          <Text style={{ color: "#F59E0B", fontWeight: "600", flex: 1 }}>
                            預計 {order.estimatedTime} 分鐘後完成
                          </Text>
                        </View>
                      )}

                      {["pending", "preparing"].includes(order.status) && (
                        <Button
                          text="取消訂單"
                          onPress={() => handleCancelOrder(order.id)}
                        />
                      )}
                    </View>
                  </AnimatedCard>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}
