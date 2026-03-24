/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Alert, Share, Platform, StyleSheet, Dimensions, Vibration } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, AnimatedCard, Button, Pill, SegmentedControl, InfoRow, FeatureHighlight } from "../ui/components";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncStorage } from "../hooks/useStorage";
import { analytics } from "../services/analytics";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

let QRCode: any = null;
try {
  QRCode = require("react-native-qrcode-svg").default;
} catch {
  QRCode = null;
}

type QRMode = "scan" | "generate";
type QRType = "checkin" | "group" | "profile" | "custom";

let CameraView: any = null;
let useCameraPermissions: any = null;
try {
  const cameraModule = require("expo-camera");
  CameraView = cameraModule.CameraView;
  useCameraPermissions = cameraModule.useCameraPermissions;
} catch {
  CameraView = null;
  useCameraPermissions = null;
}

const QR_TYPES = [
  { key: "checkin", label: "活動簽到", icon: "calendar-outline", color: theme.colors.accent },
  { key: "group", label: "加入群組", icon: "people-outline", color: theme.colors.success },
  { key: "profile", label: "個人名片", icon: "person-outline", color: "#F59E0B" },
  { key: "custom", label: "自訂內容", icon: "create-outline", color: "#8B5CF6" },
];

function generateSecureHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function generateQRPayload(type: QRType, userId?: string, schoolId?: string, customData?: Record<string, string>): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  const baseData = {
    v: "1",
    t: type,
    u: userId ?? "guest",
    s: schoolId ?? "default",
    ts: timestamp,
    n: nonce,
    ...customData,
  };
  
  const payload = JSON.stringify(baseData);
  const signature = generateSecureHash(payload);
  
  const finalData = { ...baseData, sig: signature };
  const encodedPayload = btoa(JSON.stringify(finalData));
  
  switch (type) {
    case "checkin":
      return `campus://checkin?data=${encodedPayload}`;
    case "group":
      return `campus://group/join?data=${encodedPayload}`;
    case "profile":
      return `campus://profile?data=${encodedPayload}`;
    case "custom":
      return `campus://custom?data=${encodedPayload}`;
    default:
      return `campus://unknown?data=${encodedPayload}`;
  }
}

function parseQRPayload(url: string): { type: string; data: Record<string, any>; isValid: boolean } | null {
  try {
    const match = url.match(/campus:\/\/([^/?]+)(?:\/[^?]*)?(?:\?data=(.+))?/);
    if (!match) return null;
    
    const type = match[1];
    const encodedData = match[2];
    
    if (!encodedData) {
      const simpleMatch = url.match(/campus:\/\/(\w+)\/join\/([A-Z0-9]+)/);
      if (simpleMatch) {
        return { type: simpleMatch[1], data: { code: simpleMatch[2] }, isValid: true };
      }
      return { type, data: {}, isValid: true };
    }
    
    const decoded = JSON.parse(atob(encodedData));
    const { sig, ...payload } = decoded;
    
    const expectedSig = generateSecureHash(JSON.stringify({
      v: payload.v,
      t: payload.t,
      u: payload.u,
      s: payload.s,
      ts: payload.ts,
      n: payload.n,
    }));
    
    const isValid = sig === expectedSig;
    const isExpired = Date.now() - payload.ts > 24 * 60 * 60 * 1000;
    
    return { type, data: payload, isValid: isValid && !isExpired };
  } catch {
    return null;
  }
}

function ScannerOverlay() {
  const { width } = Dimensions.get("window");
  const scannerSize = width * 0.7;

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
        <View style={{ width: scannerSize, height: scannerSize, position: "relative" }}>
          <View style={{ position: "absolute", top: 0, left: 0, width: 30, height: 30, borderTopWidth: 3, borderLeftWidth: 3, borderColor: theme.colors.accent }} />
          <View style={{ position: "absolute", top: 0, right: 0, width: 30, height: 30, borderTopWidth: 3, borderRightWidth: 3, borderColor: theme.colors.accent }} />
          <View style={{ position: "absolute", bottom: 0, left: 0, width: 30, height: 30, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: theme.colors.accent }} />
          <View style={{ position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderBottomWidth: 3, borderRightWidth: 3, borderColor: theme.colors.accent }} />
        </View>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      </View>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", paddingTop: 20 }}>
        <Text style={{ color: "#fff", fontSize: 14, textAlign: "center" }}>將 QR 碼置於框內掃描</Text>
      </View>
    </View>
  );
}

export function QRCodeScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { schoolId } = useSchool();
  const useResolvedCameraPermissions =
    useCameraPermissions ??
    (() => [null, async () => null] as const);

  const [mode, setMode] = useState<QRMode>("generate");
  const [qrType, setQrType] = useState<QRType>("checkin");
  const [generatedQR, setGeneratedQR] = useState<string>("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [storedScans, setStoredScans] = useAsyncStorage<Array<{ data: string; time: string; type: string }>>("qr_recent_scans", {
    defaultValue: [],
  });
  const [recentScans, setRecentScans] = useState<Array<{ data: string; time: Date; type: string }>>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [customContent, setCustomContent] = useState<string>("");
  const qrRef = useRef<any>(null);

  const [cameraPermission, requestCameraPermission] = useResolvedCameraPermissions();
  const hasCameraSupport = CameraView !== null && useCameraPermissions !== null;
  const hasQRCodeSupport = QRCode !== null;

  useEffect(() => {
    if (storedScans) {
      setRecentScans(storedScans.map(s => ({ ...s, time: new Date(s.time) })));
    }
  }, [storedScans]);

  const regenerateQR = useCallback(() => {
    const customData = qrType === "custom" && customContent ? { content: customContent } : undefined;
    const newQR = generateQRPayload(qrType, auth.user?.uid, schoolId, customData);
    setGeneratedQR(newQR);
    setExpiresAt(new Date(Date.now() + 24 * 60 * 60 * 1000));
    analytics.logEvent("qr_generated", { type: qrType });
  }, [qrType, auth.user?.uid, schoolId, customContent]);

  useEffect(() => {
    if (mode === "generate") {
      regenerateQR();
      setIsCameraActive(false);
    }
  }, [mode, qrType, auth.user?.uid, schoolId, regenerateQR]);

  const handleBarCodeScanned = (scanningResult: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    Vibration.vibrate(100);

    const data = scanningResult.data;
    let type = "未知";
    let isValid = true;

    const parsed = parseQRPayload(data);
    if (parsed) {
      isValid = parsed.isValid;
      switch (parsed.type) {
        case "group":
          type = "群組邀請";
          break;
        case "checkin":
          type = "活動簽到";
          break;
        case "profile":
          type = "個人名片";
          break;
        case "custom":
          type = "自訂內容";
          break;
        default:
          type = "校園 QR 碼";
      }
    } else if (data.startsWith("http://") || data.startsWith("https://")) {
      type = "網址";
    }

    if (!isValid) {
      type = `${type} (已過期/無效)`;
    }

    setScanResult(data);
    const newScan = { data, time: new Date(), type };
    setRecentScans((prev) => {
      const updated = [newScan, ...prev.slice(0, 9)];
      setStoredScans(updated.map(s => ({ ...s, time: s.time.toISOString() })));
      return updated;
    });
    setIsCameraActive(false);

    analytics.logEvent("qr_scanned", { type, is_valid: isValid });
    setTimeout(() => setScanned(false), 2000);
  };

  const handleStartScan = async () => {
    if (!hasCameraSupport) {
      Alert.alert(
        "相機功能",
        "真實相機掃描需要安裝 expo-camera。目前使用模擬模式。",
        [
          { text: "取消", style: "cancel" },
          {
            text: "模擬掃描",
            onPress: () => {
              const mockData = `campus://group/join/${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
              setScanResult(mockData);
              setRecentScans((prev) => [{ data: mockData, time: new Date(), type: "群組邀請" }, ...prev.slice(0, 9)]);
            },
          },
        ]
      );
      return;
    }

    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert("權限被拒絕", "需要相機權限才能掃描 QR 碼");
        return;
      }
    }

    setIsCameraActive(true);
    setScanned(false);
  };

  const handleScan = () => {
    handleStartScan();
  };

  const handleProcessScanResult = (data: string) => {
    const parsed = parseQRPayload(data);
    
    if (parsed && !parsed.isValid) {
      Alert.alert("無效的 QR 碼", "此 QR 碼已過期或無效，請要求對方重新產生。");
      return;
    }
    
    if (parsed) {
      switch (parsed.type) {
        case "group":
          Alert.alert(
            "加入群組",
            `發現群組邀請\n來自：${parsed.data.u || "未知"}`,
            [
              { text: "取消", style: "cancel" },
              {
                text: "加入群組",
                onPress: () => {
                  analytics.logEvent("qr_action", { action: "join_group" });
                  Alert.alert("成功", "已成功加入群組！");
                  nav?.navigate?.("收件匣");
                },
              },
            ]
          );
          return;
        case "checkin":
          analytics.logEvent("qr_action", { action: "checkin" });
          Alert.alert("簽到成功", `已完成活動簽到！\n簽到時間：${new Date().toLocaleString()}`);
          return;
        case "profile":
          const userId = parsed.data.u;
          Alert.alert("個人名片", `用戶：${userId}`, [
            { text: "關閉" },
            { 
              text: "發送訊息", 
              onPress: () => {
                analytics.logEvent("qr_action", { action: "send_message", target_user: userId });
                nav?.navigate?.("收件匣", { screen: "Chat", params: { peerId: userId } });
              }
            },
          ]);
          return;
        case "custom":
          Alert.alert("自訂內容", parsed.data.content || "無內容");
          return;
      }
    }
    
    if (data.startsWith("http://") || data.startsWith("https://")) {
      Alert.alert(
        "開啟網址",
        data,
        [
          { text: "取消", style: "cancel" },
          {
            text: "開啟",
            onPress: async () => {
              const { Linking } = require("react-native");
              await Linking.openURL(data);
            },
          },
        ]
      );
      return;
    }
    
    Alert.alert("QR 碼內容", data);
  };

  const handleShare = async () => {
    try {
      analytics.logEvent("qr_shared", { type: qrType });
      await Share.share({
        message: `這是我的校園 App QR 碼：\n${generatedQR}`,
        title: "分享 QR 碼",
      });
    } catch {}
  };

  const handleSaveToGallery = async () => {
    try {
      if (hasQRCodeSupport && qrRef.current) {
        qrRef.current.toDataURL(async (dataURL: string) => {
          try {
            const { MediaLibrary } = require("expo-media-library");
            const { FileSystem } = require("expo-file-system");
            
            const permission = await MediaLibrary.requestPermissionsAsync();
            if (!permission.granted) {
              Alert.alert("權限被拒絕", "需要相簿權限才能儲存圖片");
              return;
            }
            
            const fileUri = FileSystem.documentDirectory + `qr-${Date.now()}.png`;
            await FileSystem.writeAsStringAsync(fileUri, dataURL, {
              encoding: FileSystem.EncodingType.Base64,
            });
            
            await MediaLibrary.saveToLibraryAsync(fileUri);
            analytics.logEvent("qr_saved", { type: qrType });
            Alert.alert("儲存成功", "QR 碼圖片已儲存到相簿");
          } catch (error) {
            console.warn("Failed to save QR:", error);
            Alert.alert("儲存失敗", "無法儲存 QR 碼圖片");
          }
        });
      } else {
        Alert.alert("提示", "需要安裝 react-native-qrcode-svg 才能儲存 QR 碼圖片");
      }
    } catch (error) {
      Alert.alert("儲存失敗", "無法儲存 QR 碼圖片");
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <SegmentedControl
          options={[
            { key: "generate", label: "產生 QR 碼" },
            { key: "scan", label: "掃描 QR 碼" },
          ]}
          selected={mode}
          onChange={(k) => setMode(k as QRMode)}
        />

        {mode === "generate" ? (
          <>
            <AnimatedCard title="選擇 QR 碼類型" subtitle="點擊選擇要產生的 QR 碼">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {QR_TYPES.map((type) => (
                  <Pressable
                    key={type.key}
                    onPress={() => setQrType(type.key as QRType)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: "45%",
                      padding: 16,
                      borderRadius: theme.radius.lg,
                      borderWidth: 2,
                      borderColor: qrType === type.key ? type.color : theme.colors.border,
                      backgroundColor: qrType === type.key ? `${type.color}15` : pressed ? theme.colors.surface2 : "transparent",
                      alignItems: "center",
                      gap: 8,
                    })}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: `${type.color}20`,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={type.icon as any} size={22} color={type.color} />
                    </View>
                    <Text
                      style={{
                        color: qrType === type.key ? type.color : theme.colors.text,
                        fontWeight: "700",
                        fontSize: 13,
                      }}
                    >
                      {type.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </AnimatedCard>

            <AnimatedCard title="你的 QR 碼" subtitle={QR_TYPES.find((t) => t.key === qrType)?.label} delay={100}>
              <View style={{ alignItems: "center", padding: 20 }}>
                <View
                  style={{
                    width: 220,
                    height: 220,
                    backgroundColor: "#fff",
                    borderRadius: theme.radius.lg,
                    alignItems: "center",
                    justifyContent: "center",
                    shadowColor: "#000",
                    shadowOpacity: 0.1,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                    padding: 10,
                  }}
                >
                  {hasQRCodeSupport && generatedQR ? (
                    <QRCode
                      value={generatedQR}
                      size={180}
                      color="#333"
                      backgroundColor="#fff"
                      logo={require("../../assets/icon.png")}
                      logoSize={40}
                      logoBackgroundColor="#fff"
                      logoMargin={4}
                      logoBorderRadius={8}
                      getRef={(ref: any) => (qrRef.current = ref)}
                    />
                  ) : (
                    <View
                      style={{
                        width: 180,
                        height: 180,
                        borderWidth: 2,
                        borderColor: "#333",
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#f9f9f9",
                      }}
                    >
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        {[0, 1, 2, 3, 4, 5].map((row) => (
                          <View key={row} style={{ gap: 4 }}>
                            {[0, 1, 2, 3, 4, 5].map((col) => {
                              const hash = (row * 7 + col * 11 + generatedQR.length) % 10;
                              return (
                                <View
                                  key={col}
                                  style={{
                                    width: 18,
                                    height: 18,
                                    backgroundColor: hash > 4 ? "#333" : "#fff",
                                    borderRadius: 2,
                                  }}
                                />
                              );
                            })}
                          </View>
                        ))}
                      </View>
                      <View
                        style={{
                          position: "absolute",
                          width: 44,
                          height: 44,
                          backgroundColor: theme.colors.accent,
                          borderRadius: 10,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="school" size={26} color="#fff" />
                      </View>
                    </View>
                  )}
                </View>

                {expiresAt && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                    <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      有效至：{expiresAt.toLocaleString()}
                    </Text>
                  </View>
                )}

                {!hasQRCodeSupport && (
                  <Text style={{ color: theme.colors.danger, fontSize: 11, marginTop: 8 }}>
                    提示：安裝 react-native-qrcode-svg 以顯示真實 QR 碼
                  </Text>
                )}
              </View>

              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
                <Button text="分享" onPress={handleShare} />
                <Button text="儲存圖片" onPress={handleSaveToGallery} />
                <Button text="重新產生" onPress={regenerateQR} />
              </View>
            </AnimatedCard>

            <AnimatedCard title="使用說明" subtitle="如何使用 QR 碼" delay={200}>
              <View style={{ gap: 10 }}>
                <FeatureHighlight
                  icon="calendar-outline"
                  title="活動簽到"
                  description="參加活動時出示此 QR 碼，讓主辦方掃描即可完成簽到"
                  color={theme.colors.accent}
                />
                <FeatureHighlight
                  icon="people-outline"
                  title="加入群組"
                  description="將群組 QR 碼分享給朋友，讓他們快速加入你的群組"
                  color={theme.colors.success}
                />
                <FeatureHighlight
                  icon="person-outline"
                  title="個人名片"
                  description="分享你的個人 QR 碼，讓其他同學快速加你好友"
                  color="#F59E0B"
                />
              </View>
            </AnimatedCard>
          </>
        ) : (
          <>
            {isCameraActive && hasCameraSupport && CameraView ? (
              <View style={{ borderRadius: theme.radius.lg, overflow: "hidden", height: 350 }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                  enableTorch={flashOn}
                >
                  <ScannerOverlay />
                  <View style={{ position: "absolute", bottom: 20, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 20 }}>
                    <Pressable
                      onPress={() => setFlashOn(!flashOn)}
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                        backgroundColor: flashOn ? theme.colors.accent : "rgba(255,255,255,0.3)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={flashOn ? "flash" : "flash-outline"} size={24} color="#fff" />
                    </Pressable>
                    <Pressable
                      onPress={() => setIsCameraActive(false)}
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                        backgroundColor: "rgba(255,255,255,0.3)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="close" size={24} color="#fff" />
                    </Pressable>
                  </View>
                </CameraView>
              </View>
            ) : (
              <AnimatedCard title="掃描 QR 碼" subtitle="對準 QR 碼即可掃描">
                <View style={{ alignItems: "center", padding: 20 }}>
                  <Pressable
                    onPress={handleScan}
                    style={({ pressed }) => ({
                      width: 240,
                      height: 240,
                      backgroundColor: theme.colors.surface2,
                      borderRadius: theme.radius.lg,
                      borderWidth: 2,
                      borderColor: pressed ? theme.colors.accent : theme.colors.border,
                      borderStyle: "dashed",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 40,
                        backgroundColor: theme.colors.accentSoft,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 12,
                      }}
                    >
                      <Ionicons name="scan" size={40} color={theme.colors.accent} />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>點擊開始掃描</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>將相機對準 QR 碼</Text>
                    {hasCameraSupport && (
                      <Text style={{ color: theme.colors.success, fontSize: 11, marginTop: 8 }}>✓ 真實相機可用</Text>
                    )}
                  </Pressable>
                </View>

                <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 8 }}>
                  <Pressable
                    onPress={() => Alert.alert("選擇圖片", "從相簿選擇 QR 碼圖片")}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    })}
                  >
                    <Ionicons name="image-outline" size={18} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>從相簿選擇</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (hasCameraSupport) {
                        setFlashOn(!flashOn);
                        Alert.alert(flashOn ? "閃光燈已關閉" : "閃光燈已開啟", "開始掃描時閃光燈會自動啟用");
                      } else {
                        Alert.alert("提示", "閃光燈需要相機支援");
                      }
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: flashOn ? theme.colors.accentSoft : pressed ? theme.colors.border : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: flashOn ? theme.colors.accent : theme.colors.border,
                    })}
                  >
                    <Ionicons name={flashOn ? "flash" : "flash-outline"} size={18} color={flashOn ? theme.colors.accent : theme.colors.muted} />
                    <Text style={{ color: flashOn ? theme.colors.accent : theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                      {flashOn ? "閃光燈開" : "閃光燈"}
                    </Text>
                  </Pressable>
                </View>
              </AnimatedCard>
            )}

            {scanResult && (
              <AnimatedCard title="掃描結果" subtitle="最近一次掃描" delay={100}>
                <View
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accentSoft,
                    borderLeftWidth: 3,
                    borderLeftColor: theme.colors.accent,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={2}>
                    {scanResult}
                  </Text>
                </View>
                <View style={{ marginTop: 12 }}>
                  <Button text="處理此 QR 碼" kind="primary" onPress={() => handleProcessScanResult(scanResult)} />
                </View>
              </AnimatedCard>
            )}

            {recentScans.length > 0 && (
              <AnimatedCard title="掃描紀錄" subtitle={`共 ${recentScans.length} 筆`} delay={200}>
                <View style={{ gap: 10 }}>
                  {recentScans.slice(0, 5).map((scan, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => handleProcessScanResult(scan.data)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="qr-code" size={18} color={theme.colors.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{scan.type}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                          {scan.time.toLocaleString()}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            )}

            <AnimatedCard title="支援的 QR 碼類型" subtitle="可識別以下類型" delay={300}>
              <View style={{ gap: 10 }}>
                {QR_TYPES.map((type) => (
                  <View
                    key={type.key}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: `${type.color}20`,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={type.icon as any} size={16} color={type.color} />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{type.label}</Text>
                  </View>
                ))}
              </View>
            </AnimatedCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
