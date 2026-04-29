/* eslint-disable */
/**
 * 校園餐廳主畫面 — 靜宜大學三間餐廳（靜園、宜園、至善美食廣場）
 *
 * 角色邏輯：
 *   學生 — 瀏覽餐廳 → 選店家 → 看菜單 → 點餐 → 追蹤訂單 → 評價
 *   店家 — 管理菜單 → 接單/出餐 → 查看評價 → 營業狀態切換
 *   管理員 — 管理公告 → 衛生稽查 → 店家管理 → 統計數據
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Card, ErrorState, LoadingState, Pill, Screen, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import {
  getCafeterias,
  getVendors,
  getVendor,
  getMenuItems,
  getMenuItemsAsync,
  getReviews,
  addReview,
  getOrders,
  createOrder,
  getFavoriteVendors,
  toggleFavoriteVendor,
  estimateCrowdLevel,
  isVendorCurrentlyOpen,
  searchVendors,
  predictCrowdBySchedule,
  getMonthlyBudget,
  setMonthlyBudgetLimit,
  trackSpending,
  getFlashDeals,
  claimFlashDeal,
  getGroupOrders,
  createGroupOrder,
  joinGroupOrder,
  logNutrition,
  getNutritionLog,
  CAFETERIAS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  CROWD_LABELS,
  CROWD_COLORS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  type Cafeteria,
  type CafeteriaId,
  type Vendor,
  type VendorCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type Review,
  type MonthlyBudget,
  type FlashDeal,
  type GroupOrder,
  type NutritionEntry,
} from "../services/cafeteriaData";

// ══════════════════════════════════════════════════
// 主畫面
// ══════════════════════════════════════════════════

export function CafeteriaScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const role = auth.profile?.role ?? "student";

  const [selectedCafeteria, setSelectedCafeteria] = useState<CafeteriaId | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"browse" | "orders" | "manage">("browse");
  const crowdLevel = estimateCrowdLevel();

  // 創新功能狀態
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);
  const [flashDeals, setFlashDeals] = useState<FlashDeal[]>([]);
  const [groupOrders, setGroupOrders] = useState<GroupOrder[]>([]);
  const [showBudgetEditor, setShowBudgetEditor] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupVendorId, setGroupVendorId] = useState("");
  const [groupMaxMembers, setGroupMaxMembers] = useState("5");
  const [groupDeadlineHours, setGroupDeadlineHours] = useState("2");

  // 載入收藏 + 創新功能資料
  useEffect(() => {
    getFavoriteVendors().then(setFavorites).catch(() => {});
    const uid = auth.user?.uid ?? "anon";
    getMonthlyBudget(uid).then(setBudget).catch(() => {});
    getFlashDeals().then(setFlashDeals).catch(() => {});
    getGroupOrders().then(setGroupOrders).catch(() => {});
  }, [auth.user?.uid]);

  const handleToggleFav = useCallback(async (vendorId: string) => {
    const isFav = await toggleFavoriteVendor(vendorId);
    setFavorites(await getFavoriteVendors());
  }, []);

  // 搜尋結果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchVendors(searchQuery.trim());
  }, [searchQuery]);

  // 目前選中的餐廳店家
  const currentVendors = useMemo(() => {
    if (searchResults) return searchResults;
    if (!selectedCafeteria) return [];
    return getVendors(selectedCafeteria);
  }, [selectedCafeteria, searchResults]);

  // 如果選了某個店家，顯示店家詳情
  if (selectedVendor) {
    return (
      <VendorDetailView
        vendor={selectedVendor}
        isFavorite={favorites.includes(selectedVendor.id)}
        onToggleFav={() => handleToggleFav(selectedVendor.id)}
        onBack={() => setSelectedVendor(null)}
        userUid={auth.user?.uid ?? "anon"}
        userName={auth.user?.displayName ?? "匿名"}
        role={role}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* 標題 */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 22 }}>校園餐廳</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              靜宜大學 · 3 間餐廳 · {CAFETERIAS.reduce((s, c) => s + c.seats, 0)} 個座位
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {/* 管理員入口 */}
            {(role === "admin" || role === "staff") && (
              <Pressable
                onPress={() => nav?.navigate?.("AdminCafeteria")}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: "#7C3AED10", borderWidth: 1, borderColor: "#7C3AED30",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#7C3AED" />
              </Pressable>
            )}
            {/* 店家管理入口 */}
            {(role === "admin" || role === "staff" || role === "teacher") && (
              <Pressable
                onPress={() => nav?.navigate?.("VendorManagement")}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: "#16A34A10", borderWidth: 1, borderColor: "#16A34A30",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="storefront-outline" size={18} color="#16A34A" />
              </Pressable>
            )}
            {/* 我的訂單 */}
            <Pressable
              onPress={() => setShowOrdersModal(true)}
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name="receipt-outline" size={18} color={theme.colors.accent} />
            </Pressable>
          </View>
        </View>

        {/* 智慧人潮預測（創新：結合課表） */}
        {(() => {
          const prediction = predictCrowdBySchedule(selectedCafeteria ?? "jingyuan");
          return (
            <View style={{
              padding: 12, borderRadius: 12,
              backgroundColor: `${CROWD_COLORS[prediction.level]}08`,
              borderWidth: 1, borderColor: `${CROWD_COLORS[prediction.level]}30`,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Ionicons name="analytics-outline" size={16} color={CROWD_COLORS[prediction.level]} />
                <Text style={{ color: CROWD_COLORS[prediction.level], fontSize: 13, fontWeight: "700" }}>
                  智慧人潮預測
                </Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: `${CROWD_COLORS[prediction.level]}20` }}>
                  <Text style={{ color: CROWD_COLORS[prediction.level], fontSize: 10, fontWeight: "700" }}>
                    {CROWD_LABELS[prediction.level]}
                  </Text>
                </View>
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 12, marginBottom: 2 }}>
                {prediction.prediction}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {prediction.nextQuietTime}
              </Text>
            </View>
          );
        })()}

        {/* 每月餐費預算（創新功能） */}
        {budget && (
          <Pressable
            onPress={() => {
              setBudgetInput(budget.budgetLimit.toString());
              setShowBudgetEditor(true);
            }}
            style={{
              padding: 12, borderRadius: 12,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1, borderColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="wallet-outline" size={16} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }}>
                  本月餐費
                </Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {budget.orders} 次訂餐 · 點擊設定預算
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>
                NT${budget.spent}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                / {budget.budgetLimit}
              </Text>
            </View>
            {/* 進度條 */}
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface, overflow: "hidden" }}>
              <View style={{
                height: "100%",
                width: `${Math.min((budget.spent / budget.budgetLimit) * 100, 100)}%`,
                borderRadius: 3,
                backgroundColor: budget.spent > budget.budgetLimit * 0.9
                  ? "#DC2626"
                  : budget.spent > budget.budgetLimit * 0.7
                    ? "#F59E0B"
                    : theme.colors.accent,
              }} />
            </View>
            {budget.spent > budget.budgetLimit * 0.9 && (
              <Text style={{ color: "#DC2626", fontSize: 11, marginTop: 4, fontWeight: "600" }}>
                已接近預算上限，注意控制開支
              </Text>
            )}
          </Pressable>
        )}

        {/* 惜食快閃折扣（創新功能） */}
        {flashDeals.length > 0 && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="flash" size={16} color="#F59E0B" />
              <SectionTitle text="惜食快閃折扣" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, paddingHorizontal: 16 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {flashDeals.map(deal => {
                  const vendor = getVendor(deal.vendorId);
                  const discount = Math.round((1 - deal.discountPrice / deal.originalPrice) * 100);
                  const expiresIn = Math.max(0, Math.round((new Date(deal.expiresAt).getTime() - Date.now()) / 60000));
                  return (
                    <Pressable
                      key={deal.id}
                      onPress={async () => {
                        const result = await claimFlashDeal(deal.id);
                        if (result) {
                          Alert.alert("搶到了！", `${deal.menuItemName} 以 NT$${deal.discountPrice} 加入訂單`);
                          getFlashDeals().then(setFlashDeals);
                        } else {
                          Alert.alert("已搶完", "此優惠已被搶光");
                        }
                      }}
                      style={{
                        width: 160, padding: 12, borderRadius: 12,
                        backgroundColor: "#F59E0B08",
                        borderWidth: 1, borderColor: "#F59E0B30",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: "#DC262620" }}>
                          <Text style={{ color: "#DC2626", fontSize: 11, fontWeight: "800" }}>-{discount}%</Text>
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                          剩 {deal.remainingQty} 份
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 13, marginBottom: 2 }} numberOfLines={1}>
                        {deal.menuItemName}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }} numberOfLines={1}>
                        {vendor?.name ?? ""} · {deal.reason}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: "#DC2626", fontWeight: "800", fontSize: 15 }}>
                          NT${deal.discountPrice}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, textDecorationLine: "line-through" }}>
                          ${deal.originalPrice}
                        </Text>
                      </View>
                      <Text style={{ color: "#F59E0B", fontSize: 10, marginTop: 4, fontWeight: "600" }}>
                        {expiresIn > 60 ? `${Math.floor(expiresIn / 60)}h ${expiresIn % 60}m 後結束` : `${expiresIn} 分鐘後結束`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* 揪團訂餐（創新功能） */}
        {!selectedCafeteria && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="people-circle-outline" size={16} color="#7C3AED" />
                <SectionTitle text="揪團訂餐" />
              </View>
              <Pressable
                onPress={() => setShowGroupCreate(true)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                  backgroundColor: "#7C3AED", flexDirection: "row", alignItems: "center", gap: 4,
                }}
              >
                <Ionicons name="add" size={14} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>開團</Text>
              </Pressable>
            </View>
            {groupOrders.length > 0 ? (
              <View style={{ gap: 8 }}>
                {groupOrders.slice(0, 3).map(group => {
                  const vendor = getVendor(group.vendorId);
                  const deadline = new Date(group.deadline);
                  const remaining = Math.max(0, Math.round((deadline.getTime() - Date.now()) / 60000));
                  return (
                    <Pressable
                      key={group.id}
                      onPress={async () => {
                        if (group.status !== "open") {
                          Alert.alert("已截止", "此團已截止報名");
                          return;
                        }
                        const uid = auth.user?.uid ?? "anon";
                        const name = auth.user?.displayName ?? "匿名";
                        if (group.members.some(m => m.uid === uid)) {
                          Alert.alert("已加入", "你已經在這個團裡了");
                          return;
                        }
                        await joinGroupOrder(group.id, { uid, name, items: [], subtotal: 0 });
                        Alert.alert("成功", "已加入揪團！");
                        getGroupOrders().then(setGroupOrders);
                      }}
                      style={{
                        padding: 12, borderRadius: 12,
                        backgroundColor: "#7C3AED08",
                        borderWidth: 1, borderColor: "#7C3AED30",
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                          {group.title}
                        </Text>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: group.status === "open" ? "#16A34A20" : "#F59E0B20" }}>
                          <Text style={{ color: group.status === "open" ? "#16A34A" : "#F59E0B", fontSize: 10, fontWeight: "600" }}>
                            {group.status === "open" ? "招募中" : "已截止"}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                        {vendor?.name ?? group.vendorName} · {group.creatorName} 發起
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Ionicons name="people-outline" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>
                            {group.members.length}/{group.maxMembers}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                          <Text style={{ color: remaining < 30 ? "#DC2626" : theme.colors.muted, fontSize: 12 }}>
                            {remaining > 60 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m` : `${remaining}m`} 後截止
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={{ padding: 20, alignItems: "center", borderRadius: 12, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
                <Ionicons name="people-circle-outline" size={32} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8 }}>
                  目前沒有揪團，點擊「開團」發起一個吧！
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 搜尋 */}
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          padding: 10, borderRadius: 12,
          backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
        }}>
          <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="搜尋店家、菜色、類型..."
            placeholderTextColor={theme.colors.muted}
            style={{ flex: 1, color: theme.colors.text, fontSize: 14, padding: 0 }}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* 搜尋結果 */}
        {searchResults ? (
          <View style={{ gap: 8 }}>
            <SectionTitle text={`搜尋「${searchQuery}」— ${searchResults.length} 間店家`} />
            {searchResults.map(v => (
              <VendorCard
                key={v.id}
                vendor={v}
                isFavorite={favorites.includes(v.id)}
                onPress={() => setSelectedVendor(v)}
                onToggleFav={() => handleToggleFav(v.id)}
              />
            ))}
            {searchResults.length === 0 && (
              <Text style={{ color: theme.colors.muted, fontSize: 13, textAlign: "center", padding: 20 }}>
                找不到相關店家，試試其他關鍵字
              </Text>
            )}
          </View>
        ) : (
          <>
            {/* 三間餐廳卡片 */}
            <SectionTitle text="選擇餐廳" />
            <View style={{ gap: 10 }}>
              {CAFETERIAS.map(caf => (
                <CafeteriaCard
                  key={caf.id}
                  cafeteria={caf}
                  vendorCount={getVendors(caf.id).length}
                  isSelected={selectedCafeteria === caf.id}
                  onPress={() => setSelectedCafeteria(selectedCafeteria === caf.id ? null : caf.id)}
                />
              ))}
            </View>

            {/* 選中餐廳的店家列表 */}
            {selectedCafeteria && (
              <View style={{ gap: 8 }}>
                <SectionTitle text={`${getCafeterias().find(c => c.id === selectedCafeteria)?.name ?? ""} 店家`} />
                {currentVendors.map(v => (
                  <VendorCard
                    key={v.id}
                    vendor={v}
                    isFavorite={favorites.includes(v.id)}
                    onPress={() => setSelectedVendor(v)}
                    onToggleFav={() => handleToggleFav(v.id)}
                  />
                ))}
              </View>
            )}

            {/* 收藏店家 */}
            {favorites.length > 0 && !selectedCafeteria && (
              <View style={{ gap: 8 }}>
                <SectionTitle text="我的收藏" />
                {favorites.map(fid => {
                  const v = getVendor(fid);
                  if (!v) return null;
                  return (
                    <VendorCard
                      key={v.id}
                      vendor={v}
                      isFavorite
                      onPress={() => setSelectedVendor(v)}
                      onToggleFav={() => handleToggleFav(v.id)}
                    />
                  );
                })}
              </View>
            )}

            {/* 熱門推薦（首頁沒選餐廳時） */}
            {!selectedCafeteria && (
              <View style={{ gap: 8 }}>
                <SectionTitle text="熱門推薦" />
                {[...getVendors()].sort((a, b) => b.rating * b.ratingCount - a.rating * a.ratingCount).slice(0, 5).map(v => (
                  <VendorCard
                    key={v.id}
                    vendor={v}
                    isFavorite={favorites.includes(v.id)}
                    onPress={() => setSelectedVendor(v)}
                    onToggleFav={() => handleToggleFav(v.id)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 訂單歷史 Modal */}
      {showOrdersModal && (
        <OrdersModal
          userUid={auth.user?.uid ?? "anon"}
          role={role}
          onClose={() => setShowOrdersModal(false)}
        />
      )}

      {/* 預算編輯 Modal */}
      {showBudgetEditor && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowBudgetEditor(false)}>
          <View style={{ flex: 1, backgroundColor: "#00000060", justifyContent: "center", alignItems: "center" }}>
            <View style={{ width: "80%", backgroundColor: theme.colors.background, borderRadius: 16, padding: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Ionicons name="wallet-outline" size={20} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>設定每月餐費預算</Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
                設定後會追蹤你的訂餐支出，幫助你控制餐費開銷
              </Text>
              <TextInput
                value={budgetInput}
                onChangeText={setBudgetInput}
                placeholder="例如：6000"
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                style={{
                  borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
                  padding: 12, color: theme.colors.text, fontSize: 16, fontWeight: "700",
                  backgroundColor: theme.colors.surface2, textAlign: "center",
                }}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {[3000, 4500, 6000, 8000].map(v => (
                  <Pressable key={v} onPress={() => setBudgetInput(v.toString())}
                    style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
                    <Text style={{ color: theme.colors.text, fontSize: 12 }}>NT${v}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <Pressable onPress={() => setShowBudgetEditor(false)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.colors.surface, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const limit = parseInt(budgetInput, 10);
                    if (isNaN(limit) || limit <= 0) {
                      Alert.alert("錯誤", "請輸入正確的金額");
                      return;
                    }
                    const uid = auth.user?.uid ?? "anon";
                    await setMonthlyBudgetLimit(uid, limit);
                    const updated = await getMonthlyBudget(uid);
                    setBudget(updated);
                    setShowBudgetEditor(false);
                    Alert.alert("成功", `每月預算已設為 NT$${limit}`);
                  }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>儲存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 揪團開團 Modal */}
      {showGroupCreate && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowGroupCreate(false)}>
          <View style={{ flex: 1, backgroundColor: "#00000060", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: theme.colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Ionicons name="people-circle" size={22} color="#7C3AED" />
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>發起揪團訂餐</Text>
              </View>

              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>揪團名稱</Text>
              <TextInput value={groupTitle} onChangeText={setGroupTitle} placeholder="例如：一起訂炸雞大師！"
                placeholderTextColor={theme.colors.muted}
                style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, color: theme.colors.text, fontSize: 14, backgroundColor: theme.colors.surface2, marginBottom: 12 }} />

              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>選擇店家</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {getVendors().slice(0, 10).map(v => (
                    <Pressable key={v.id} onPress={() => setGroupVendorId(v.id)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                        backgroundColor: groupVendorId === v.id ? "#7C3AED" : theme.colors.surface2,
                        borderWidth: 1, borderColor: groupVendorId === v.id ? "#7C3AED" : theme.colors.border,
                      }}>
                      <Text style={{ color: groupVendorId === v.id ? "#fff" : theme.colors.text, fontSize: 12, fontWeight: "500" }}>{v.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>人數上限</Text>
                  <TextInput value={groupMaxMembers} onChangeText={setGroupMaxMembers}
                    keyboardType="number-pad"
                    style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, color: theme.colors.text, fontSize: 14, backgroundColor: theme.colors.surface2 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>截止時間（小時後）</Text>
                  <TextInput value={groupDeadlineHours} onChangeText={setGroupDeadlineHours}
                    keyboardType="number-pad"
                    style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, color: theme.colors.text, fontSize: 14, backgroundColor: theme.colors.surface2 }} />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setShowGroupCreate(false)}
                  style={{ flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: theme.colors.surface, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    if (!groupTitle.trim() || !groupVendorId) {
                      Alert.alert("錯誤", "請填寫名稱並選擇店家");
                      return;
                    }
                    const vendor = getVendor(groupVendorId);
                    const deadline = new Date();
                    deadline.setHours(deadline.getHours() + parseInt(groupDeadlineHours, 10) || 2);
                    await createGroupOrder({
                      creatorUid: auth.user?.uid ?? "anon",
                      creatorName: auth.user?.displayName ?? "匿名",
                      vendorId: groupVendorId,
                      vendorName: vendor?.name ?? "",
                      title: groupTitle.trim(),
                      maxMembers: parseInt(groupMaxMembers, 10) || 5,
                      deadline: deadline.toISOString(),
                      note: "",
                    });
                    Alert.alert("成功", "揪團已建立！");
                    setShowGroupCreate(false);
                    setGroupTitle("");
                    setGroupVendorId("");
                    getGroupOrders().then(setGroupOrders);
                  }}
                  style={{ flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: "#7C3AED", alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>建立揪團</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// 餐廳卡片
// ══════════════════════════════════════════════════

function CafeteriaCard(props: {
  cafeteria: Cafeteria;
  vendorCount: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const { cafeteria: caf, vendorCount, isSelected, onPress } = props;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: isSelected ? `${theme.colors.accent}08` : theme.colors.surface,
        borderWidth: isSelected ? 2 : 1,
        borderColor: isSelected ? theme.colors.accent : theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* 餐廳圖片 */}
      {caf.imageUrl && (
        <Image
          source={{ uri: caf.imageUrl }}
          style={{ width: "100%", height: 120 }}
          resizeMode="cover"
        />
      )}
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 17 }}>
            {caf.name}
          </Text>
          <Ionicons
            name={isSelected ? "chevron-up" : "chevron-down"}
            size={18}
            color={theme.colors.muted}
          />
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }} numberOfLines={2}>
          {caf.description}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <Pill text={`${caf.floors}`} kind="accent" />
          <Pill text={`${caf.seats} 座位`} kind="default" />
          <Pill text={`${vendorCount} 間店家`} kind="default" />
          <Pill text={`${caf.openTime}~${caf.closeTime}`} kind="default" />
        </View>
        {caf.features.length > 0 && (
          <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
            {caf.features.map(f => (
              <View key={f} style={{
                paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                backgroundColor: `${theme.colors.accent}10`,
              }}>
                <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: "600" }}>{f}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ══════════════════════════════════════════════════
// 店家卡片
// ══════════════════════════════════════════════════

function VendorCard(props: {
  vendor: Vendor;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFav: () => void;
}) {
  const { vendor: v, isFavorite, onPress, onToggleFav } = props;
  const isOpen = isVendorCurrentlyOpen(v);
  const iconName = (CATEGORY_ICONS[v.category] ?? "restaurant-outline") as keyof typeof Ionicons.glyphMap;
  const cafName = CAFETERIAS.find(c => c.id === v.cafeteriaId)?.name ?? "";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12,
        padding: 14, borderRadius: 14,
        backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
        borderWidth: 1, borderColor: isOpen ? theme.colors.border : "#DC262620",
        opacity: pressed ? 0.8 : isOpen ? 1 : 0.7,
      })}
    >
      <View style={{
        width: 44, height: 44, borderRadius: 12,
        backgroundColor: `${theme.colors.accent}14`,
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name={iconName} size={22} color={theme.colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{v.name}</Text>
          {!isOpen && (
            <View style={{ backgroundColor: "#DC262620", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ color: "#DC2626", fontSize: 9, fontWeight: "700" }}>休息中</Text>
            </View>
          )}
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
          {cafName} {v.floor} · {CATEGORY_LABELS[v.category]} · ${v.avgPrice}起
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
          <Ionicons name="star" size={12} color="#F59E0B" />
          <Text style={{ color: "#F59E0B", fontSize: 12, fontWeight: "700" }}>{v.rating.toFixed(1)}</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 10 }}>({v.ratingCount})</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 10 }}> · {v.openTime}~{v.closeTime}</Text>
        </View>
      </View>
      <Pressable onPress={onToggleFav} style={{ padding: 6 }}>
        <Ionicons
          name={isFavorite ? "heart" : "heart-outline"}
          size={20}
          color={isFavorite ? "#DC2626" : theme.colors.muted}
        />
      </Pressable>
    </Pressable>
  );
}

// ══════════════════════════════════════════════════
// 店家詳情頁（菜單 + 評價 + 點餐）
// ══════════════════════════════════════════════════

function VendorDetailView(props: {
  vendor: Vendor;
  isFavorite: boolean;
  onToggleFav: () => void;
  onBack: () => void;
  userUid: string;
  userName: string;
  role: string;
}) {
  const { vendor: v, isFavorite, onToggleFav, onBack, userUid, userName, role } = props;
  const [tab, setTab] = useState<"menu" | "reviews" | "info">("menu");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState(5);

  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => getMenuItems(v.id));
  const menuCategories = [...new Set(menuItems.map(m => m.category))];
  const isOpen = isVendorCurrentlyOpen(v);
  const cafName = CAFETERIAS.find(c => c.id === v.cafeteriaId)?.name ?? "";

  useEffect(() => {
    getReviews(v.id).then(setReviews).catch(() => {});
    getMenuItemsAsync(v.id).then(setMenuItems).catch(() => {});
  }, [v.id]);

  const addToCart = useCallback((item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id);
      if (existing) {
        return prev.map(c => c.menuItemId === item.id
          ? { ...c, quantity: c.quantity + 1, subtotal: (c.quantity + 1) * c.unitPrice }
          : c
        );
      }
      return [...prev, {
        menuItemId: item.id,
        menuItemName: item.name,
        quantity: 1,
        unitPrice: item.price,
        selectedOptions: [],
        subtotal: item.price,
      }];
    });
  }, []);

  const cartTotal = useMemo(() => cart.reduce((s, c) => s + c.subtotal, 0), [cart]);

  const handleOrder = useCallback(async () => {
    if (cart.length === 0) return;
    try {
      await createOrder({
        studentUid: userUid,
        vendorId: v.id,
        cafeteriaId: v.cafeteriaId,
        items: cart,
        totalPrice: cartTotal,
        note: "",
        estimatedPickup: null,
      });
      // 追蹤餐費預算
      const budgetResult = await trackSpending(userUid, cartTotal);
      // 記錄營養資訊
      for (const item of cart) {
        const menuItem = menuItems.find(m => m.id === item.menuItemId);
        await logNutrition(userUid, {
          vendorName: v.name,
          itemName: item.menuItemName,
          calories: menuItem?.calories ?? null,
        });
      }
      const budgetMsg = budgetResult.spent > budgetResult.budgetLimit * 0.9
        ? `\n\n注意：本月餐費已達 NT$${budgetResult.spent}，接近預算上限 NT$${budgetResult.budgetLimit}`
        : `\n本月累計餐費：NT$${budgetResult.spent} / ${budgetResult.budgetLimit}`;
      Alert.alert("下單成功", `訂單已送出，請到 ${cafName} ${v.floor} ${v.name} 取餐${budgetMsg}`);
      setCart([]);
      setShowCart(false);
    } catch {
      Alert.alert("下單失敗", "請稍後再試");
    }
  }, [cart, cartTotal, v, userUid, cafName, menuItems]);

  const handleReview = useCallback(async () => {
    if (!reviewText.trim()) return;
    try {
      await addReview({
        vendorId: v.id,
        studentUid: userUid,
        studentName: userName,
        rating: reviewRating,
        comment: reviewText.trim(),
        tags: [],
        orderId: null,
      });
      setReviewText("");
      setReviewRating(5);
      const updated = await getReviews(v.id);
      setReviews(updated);
      Alert.alert("評價成功", "感謝你的評價！");
    } catch {
      Alert.alert("評價失敗", "請稍後再試");
    }
  }, [reviewText, reviewRating, v.id, userUid, userName]);

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + (cart.length > 0 ? 60 : 0) }}
      >
        {/* 返回 */}
        <Pressable onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 14, fontWeight: "600" }}>返回</Text>
        </Pressable>

        {/* 店家資訊頭部 */}
        <View style={{
          padding: 16, borderRadius: 16,
          backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
          gap: 8,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 20 }}>{v.name}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                {cafName} · {v.floor} {v.stallNumber} · {CATEGORY_LABELS[v.category]}
              </Text>
            </View>
            <Pressable onPress={onToggleFav} style={{ padding: 4 }}>
              <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={24} color={isFavorite ? "#DC2626" : theme.colors.muted} />
            </Pressable>
          </View>

          <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>{v.description}</Text>

          <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
            <View style={{ alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Ionicons name="star" size={16} color="#F59E0B" />
                <Text style={{ color: "#F59E0B", fontWeight: "800", fontSize: 18 }}>{v.rating.toFixed(1)}</Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{v.ratingCount} 則評價</Text>
            </View>
            <View style={{ width: 1, backgroundColor: theme.colors.border }} />
            <View style={{ alignItems: "center" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>${v.avgPrice}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>平均消費</Text>
            </View>
            <View style={{ width: 1, backgroundColor: theme.colors.border }} />
            <View style={{ alignItems: "center" }}>
              <Text style={{ color: isOpen ? "#16A34A" : "#DC2626", fontWeight: "800", fontSize: 14 }}>
                {isOpen ? "營業中" : "休息中"}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{v.openTime}~{v.closeTime}</Text>
            </View>
          </View>

          {v.tags.length > 0 && (
            <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
              {v.tags.map(t => (
                <View key={t} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: `${theme.colors.accent}10` }}>
                  <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: "600" }}>#{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Tab 切換 */}
        <View style={{ flexDirection: "row", gap: 0, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border }}>
          {(["menu", "reviews", "info"] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{
                flex: 1, paddingVertical: 10, alignItems: "center",
                backgroundColor: tab === t ? theme.colors.accent : theme.colors.surface,
              }}
            >
              <Text style={{ color: tab === t ? "#fff" : theme.colors.muted, fontWeight: "600", fontSize: 13 }}>
                {t === "menu" ? "菜單" : t === "reviews" ? `評價(${reviews.length})` : "資訊"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 菜單 */}
        {tab === "menu" && (
          <View style={{ gap: 10 }}>
            {menuItems.length === 0 ? (
              <Card title="菜單尚未建立" subtitle="店家尚未上傳菜單">
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  可直接到店內點餐。
                </Text>
              </Card>
            ) : (
              menuCategories.map(cat => (
                <View key={cat} style={{ gap: 6 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14, paddingLeft: 4 }}>{cat}</Text>
                  {menuItems.filter(m => m.category === cat).map(item => (
                    <Pressable
                      key={item.id}
                      onPress={() => isOpen && item.isAvailable && addToCart(item)}
                      disabled={!isOpen || !item.isAvailable}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", gap: 10,
                        padding: 12, borderRadius: 12,
                        backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
                        borderWidth: 1, borderColor: theme.colors.border,
                        opacity: (!isOpen || !item.isAvailable) ? 0.5 : pressed ? 0.8 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>{item.name}</Text>
                          {item.isPopular && (
                            <View style={{ backgroundColor: "#F59E0B20", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                              <Text style={{ color: "#F59E0B", fontSize: 9, fontWeight: "700" }}>熱門</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{item.description}</Text>
                        {item.calories && (
                          <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 1 }}>{item.calories} kcal</Text>
                        )}
                      </View>
                      <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 16 }}>${item.price}</Text>
                      {isOpen && item.isAvailable && (
                        <Ionicons name="add-circle" size={24} color={theme.colors.accent} />
                      )}
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </View>
        )}

        {/* 評價 */}
        {tab === "reviews" && (
          <View style={{ gap: 10 }}>
            {/* 寫評價 */}
            <View style={{
              padding: 14, borderRadius: 14,
              backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
              gap: 8,
            }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>寫評價</Text>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <Pressable key={star} onPress={() => setReviewRating(star)}>
                    <Ionicons
                      name={star <= reviewRating ? "star" : "star-outline"}
                      size={24}
                      color="#F59E0B"
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={reviewText}
                onChangeText={setReviewText}
                placeholder="分享你的用餐體驗..."
                placeholderTextColor={theme.colors.muted}
                multiline
                style={{
                  color: theme.colors.text, fontSize: 13,
                  padding: 10, borderRadius: 8,
                  backgroundColor: theme.colors.surface2, minHeight: 60,
                  textAlignVertical: "top",
                }}
              />
              <Pressable
                onPress={handleReview}
                disabled={!reviewText.trim()}
                style={({ pressed }) => ({
                  paddingVertical: 10, borderRadius: 8, alignItems: "center",
                  backgroundColor: reviewText.trim() ? (pressed ? `${theme.colors.accent}cc` : theme.colors.accent) : theme.colors.surface3,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: reviewText.trim() ? "#fff" : theme.colors.muted, fontWeight: "700", fontSize: 14 }}>
                  送出評價
                </Text>
              </Pressable>
            </View>

            {/* 評價列表 */}
            {reviews.map(r => (
              <View key={r.id} style={{
                padding: 12, borderRadius: 12,
                backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border,
                gap: 4,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{r.studentName}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    {Array.from({ length: r.rating }).map((_, i) => (
                      <Ionicons key={i} name="star" size={12} color="#F59E0B" />
                    ))}
                  </View>
                </View>
                <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 19 }}>{r.comment}</Text>
                {r.tags.length > 0 && (
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    {r.tags.map(t => (
                      <Text key={t} style={{ color: theme.colors.accent, fontSize: 10 }}>#{t}</Text>
                    ))}
                  </View>
                )}
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  {new Date(r.createdAt).toLocaleDateString("zh-TW")}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 店家資訊 */}
        {tab === "info" && (
          <View style={{ gap: 8 }}>
            <Card title="營業資訊" subtitle="">
              <View style={{ gap: 4 }}>
                <InfoRow label="位置" value={`${cafName} ${v.floor} ${v.stallNumber}`} />
                <InfoRow label="營業時間" value={`${v.openTime} ~ ${v.closeTime}`} />
                <InfoRow label="平均消費" value={`$${v.avgPrice}`} />
                <InfoRow label="類別" value={CATEGORY_LABELS[v.category]} />
                {v.phone && <InfoRow label="電話" value={v.phone} />}
              </View>
            </Card>
          </View>
        )}
      </ScrollView>

      {/* 購物車浮動按鈕 */}
      {cart.length > 0 && (
        <Pressable
          onPress={handleOrder}
          style={{
            position: "absolute", bottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 8,
            left: 16, right: 16,
            flexDirection: "row", justifyContent: "space-between", alignItems: "center",
            padding: 16, borderRadius: 14,
            backgroundColor: theme.colors.accent,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="cart" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
              {cart.reduce((s, c) => s + c.quantity, 0)} 項
            </Text>
          </View>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>
            下單 ${cartTotal}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// InfoRow
// ══════════════════════════════════════════════════

function InfoRow(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{props.label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "600" }}>{props.value}</Text>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 訂單歷史 Modal
// ══════════════════════════════════════════════════

function OrdersModal(props: { userUid: string; role: string; onClose: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    getOrders(props.userUid).then(setOrders).catch(() => {});
  }, [props.userUid]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{
          flexDirection: "row", justifyContent: "space-between", alignItems: "center",
          padding: 16, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
        }}>
          <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>我的訂單</Text>
          <Pressable onPress={props.onClose}>
            <Ionicons name="close" size={24} color={theme.colors.muted} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {orders.length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 14, textAlign: "center", paddingTop: 40 }}>
              還沒有任何訂單
            </Text>
          ) : (
            orders.map(order => {
              const vendor = getVendor(order.vendorId);
              return (
                <View key={order.id} style={{
                  padding: 14, borderRadius: 14,
                  backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
                  gap: 6,
                }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                      {vendor?.name ?? "未知店家"}
                    </Text>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      backgroundColor: `${ORDER_STATUS_COLORS[order.status]}20`,
                    }}>
                      <Text style={{
                        color: ORDER_STATUS_COLORS[order.status],
                        fontSize: 11, fontWeight: "700",
                      }}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </Text>
                    </View>
                  </View>
                  {order.items.map((item, i) => (
                    <Text key={i} style={{ color: theme.colors.muted, fontSize: 12 }}>
                      {item.menuItemName} x{item.quantity} — ${item.subtotal}
                    </Text>
                  ))}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 4, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      {new Date(order.createdAt).toLocaleString("zh-TW")}
                    </Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                      ${order.totalPrice}
                    </Text>
                  </View>
                  {order.queueNumber && (
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                      取餐號碼：{order.queueNumber}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
