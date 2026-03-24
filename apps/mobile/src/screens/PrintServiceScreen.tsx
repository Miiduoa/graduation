/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Screen, Button, AnimatedCard, SegmentedControl, Pill } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatDateTime } from "../utils/format";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import type { Printer, PrintJob } from "../data/types";

function getStatusLabel(status: Printer["status"]): string {
  const labels: Record<string, string> = {
    online: "可使用",
    busy: "忙碌中",
    offline: "離線",
    error: "錯誤",
    outOfPaper: "缺紙",
    outOfToner: "缺墨",
  };
  return labels[status] ?? status;
}

function getStatusColor(status: Printer["status"]): string {
  const colors: Record<string, string> = {
    online: theme.colors.success,
    busy: "#F59E0B",
    offline: theme.colors.muted,
    error: theme.colors.danger,
    outOfPaper: theme.colors.danger,
    outOfToner: theme.colors.danger,
  };
  return colors[status] ?? theme.colors.muted;
}

function getJobStatusLabel(status: PrintJob["status"]): string {
  const labels: Record<string, string> = {
    pending: "等待中",
    printing: "列印中",
    completed: "已完成",
    failed: "失敗",
    cancelled: "已取消",
  };
  return labels[status] ?? status;
}

function getJobStatusColor(status: PrintJob["status"]): string {
  const colors: Record<string, string> = {
    pending: theme.colors.muted,
    printing: "#F59E0B",
    completed: theme.colors.success,
    failed: theme.colors.danger,
    cancelled: theme.colors.muted,
  };
  return colors[status] ?? theme.colors.muted;
}

export function PrintServiceScreen(props: any) {
  const nav = props?.navigation;
  const ds = useDataSource();
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [printOptions, setPrintOptions] = useState({
    color: false,
    doubleSided: true,
    copies: 1,
  });
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; size: number } | null>(null);

  const TABS = ["列印", "印表機", "紀錄"];

  const loadData = useCallback(async () => {
    try {
      const [printersData, jobsData] = await Promise.all([
        ds.listPrinters(school?.id).catch(() => []),
        auth.user?.uid ? ds.listPrintJobs(auth.user.uid, undefined, school?.id).catch(() => []) : Promise.resolve([]),
      ]);
      
      setPrinters(printersData);
      setJobs(jobsData);
    } catch (error) {
      console.error("[PrintServiceScreen] Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, [ds, school?.id, auth.user?.uid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSelectFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/*"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile({
          name: file.name,
          uri: file.uri,
          size: file.size || 0,
        });
      }
    } catch (error) {
      Alert.alert("錯誤", "無法選擇檔案，請稍後再試");
    }
  };

  const handleSubmitPrint = async () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能使用列印服務");
      return;
    }
    if (!selectedFile) {
      Alert.alert("請選擇檔案", "請先選擇要列印的檔案");
      return;
    }
    if (!selectedPrinter) {
      Alert.alert("請選擇印表機", "請先選擇要使用的印表機");
      return;
    }

    const estimatedPages = Math.ceil(selectedFile.size / 50000);
    const pricePerPage = selectedPrinter.pricePerPage ?? { bw: 1, color: 5 };
    const costPerPage = printOptions.color ? pricePerPage.color : pricePerPage.bw;
    const totalCost = estimatedPages * printOptions.copies * costPerPage * (printOptions.doubleSided ? 0.5 : 1);

    Alert.alert(
      "確認列印",
      `檔案：${selectedFile.name}\n印表機：${selectedPrinter.name}\n預估頁數：${estimatedPages} 頁\n份數：${printOptions.copies}\n${printOptions.color ? "彩色" : "黑白"} / ${printOptions.doubleSided ? "雙面" : "單面"}\n\n預估費用：$${Math.ceil(totalCost)}`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認列印",
          onPress: async () => {
            setSubmitting(true);
            try {
              const newJob = await ds.createPrintJob({
                userId: auth.user!.uid,
                schoolId: school?.id,
                printerId: selectedPrinter.id,
                fileName: selectedFile.name,
                fileUrl: selectedFile.uri,
                pages: estimatedPages,
                copies: printOptions.copies,
                color: printOptions.color,
                duplex: printOptions.doubleSided,
              });
              setJobs([newJob, ...jobs]);
              setSelectedFile(null);
              setSelectedTab(2);
              Alert.alert("已送出", `列印工作已送出至 ${selectedPrinter.name}`);
            } catch (error: any) {
              Alert.alert("送出失敗", error?.message ?? "請稍後再試");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleCancelJob = (jobId: string) => {
    Alert.alert(
      "取消列印",
      "確定要取消此列印工作嗎？",
      [
        { text: "否", style: "cancel" },
        {
          text: "是",
          style: "destructive",
          onPress: async () => {
            try {
              await ds.cancelPrintJob(jobId, school?.id);
              setJobs(jobs.map((j) => j.id === jobId ? { ...j, status: "cancelled" as const } : j));
            } catch (error: any) {
              Alert.alert("取消失敗", error?.message ?? "請稍後再試");
            }
          },
        },
      ]
    );
  };

  const availablePrinters = useMemo(() => {
    return printers.filter((p) => p.status !== "offline");
  }, [printers]);
  
  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="選擇檔案">
                {selectedFile ? (
                  <View style={{ gap: 12 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <Ionicons name="document" size={32} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
                          {selectedFile.name}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </Text>
                      </View>
                      <Pressable onPress={() => setSelectedFile(null)}>
                        <Ionicons name="close-circle" size={24} color={theme.colors.muted} />
                      </Pressable>
                    </View>
                    <Button text="更換檔案" onPress={handleSelectFile} />
                  </View>
                ) : (
                  <Pressable
                    onPress={handleSelectFile}
                    style={{
                      alignItems: "center",
                      padding: 32,
                      borderRadius: theme.radius.lg,
                      borderWidth: 2,
                      borderStyle: "dashed",
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Ionicons name="cloud-upload-outline" size={48} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 12 }}>
                      點擊選擇檔案
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      支援 PDF、Word、圖片
                    </Text>
                  </Pressable>
                )}
              </AnimatedCard>

              <AnimatedCard title="選擇印表機" delay={100}>
                {selectedPrinter ? (
                  <View style={{ gap: 12 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.accentSoft,
                        gap: 12,
                      }}
                    >
                      <Ionicons name="print" size={28} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
                          {selectedPrinter.name}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {selectedPrinter.location} · 排隊 {selectedPrinter.queueLength} 份
                        </Text>
                      </View>
                      <Pressable onPress={() => setSelectedPrinter(null)}>
                        <Ionicons name="close-circle" size={24} color={theme.colors.accent} />
                      </Pressable>
                    </View>
                    <Button text="更換印表機" onPress={() => setSelectedTab(1)} />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setSelectedTab(1)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 14,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      gap: 12,
                    }}
                  >
                    <Ionicons name="print-outline" size={24} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, flex: 1 }}>點擊選擇印表機</Text>
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
                  </Pressable>
                )}
              </AnimatedCard>

              <AnimatedCard title="列印選項" delay={150}>
                <View style={{ gap: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="color-palette-outline" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>彩色列印</Text>
                    </View>
                    <Pressable
                      onPress={() => setPrintOptions({ ...printOptions, color: !printOptions.color })}
                      style={{
                        width: 50,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: printOptions.color ? theme.colors.accent : theme.colors.border,
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
                          alignSelf: printOptions.color ? "flex-end" : "flex-start",
                        }}
                      />
                    </Pressable>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="copy-outline" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>雙面列印</Text>
                    </View>
                    <Pressable
                      onPress={() => setPrintOptions({ ...printOptions, doubleSided: !printOptions.doubleSided })}
                      style={{
                        width: 50,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: printOptions.doubleSided ? theme.colors.accent : theme.colors.border,
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
                          alignSelf: printOptions.doubleSided ? "flex-end" : "flex-start",
                        }}
                      />
                    </Pressable>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="layers-outline" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>份數</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Pressable
                        onPress={() => setPrintOptions({ ...printOptions, copies: Math.max(1, printOptions.copies - 1) })}
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
                        {printOptions.copies}
                      </Text>
                      <Pressable
                        onPress={() => setPrintOptions({ ...printOptions, copies: Math.min(99, printOptions.copies + 1) })}
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
                </View>
              </AnimatedCard>

              <AnimatedCard title="費用說明" subtitle="" delay={200}>
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>黑白單面</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$1 / 頁</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>黑白雙面</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$0.5 / 頁</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>彩色單面</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$2 / 頁</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>彩色雙面</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$1 / 頁</Text>
                  </View>
                </View>
              </AnimatedCard>

              <Button
                text="送出列印"
                kind="primary"
                onPress={handleSubmitPrint}
                disabled={!selectedFile || !selectedPrinter}
              />
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="校園印表機" subtitle={`共 ${printers.length} 台`}>
                <View style={{ gap: 10 }}>
                  {printers.map((printer, idx) => (
                    <Pressable
                      key={printer.id}
                      onPress={() => {
                        if (printer.status !== "offline") {
                          setSelectedPrinter(printer);
                          setSelectedTab(0);
                        }
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: selectedPrinter?.id === printer.id ? theme.colors.accentSoft : theme.colors.surface2,
                        gap: 12,
                        opacity: printer.status === "offline" ? 0.5 : 1,
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: `${getStatusColor(printer.status)}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="print" size={22} color={getStatusColor(printer.status)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{printer.name}</Text>
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: `${getStatusColor(printer.status)}20`,
                            }}
                          >
                            <Text style={{ color: getStatusColor(printer.status), fontSize: 10, fontWeight: "600" }}>
                              {getStatusLabel(printer.status)}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {printer.location}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                          {printer.queueLength > 0 && (
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                              排隊 {printer.queueLength} 份
                            </Text>
                          )}
                          {printer.capabilities?.includes("color") && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                              <Ionicons name="color-palette" size={12} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>彩色</Text>
                            </View>
                          )}
                          {printer.capabilities?.includes("duplex") && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                              <Ionicons name="copy" size={12} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>雙面</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {printer.status !== "offline" && (
                        <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {jobs.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
                    <Ionicons name="print-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      尚無列印紀錄
                    </Text>
                    <Button
                      text="開始列印"
                      onPress={() => setSelectedTab(0)}
                      style={{ marginTop: 20 }}
                    />
                  </View>
                </AnimatedCard>
              ) : (
                jobs.map((job, idx) => (
                  <AnimatedCard key={job.id} delay={idx * 50}>
                    <View style={{ gap: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                        <View
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            backgroundColor: `${getJobStatusColor(job.status)}20`,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="document" size={22} color={getJobStatusColor(job.status)} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                              {job.fileName}
                            </Text>
                            <View
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: theme.radius.full,
                                backgroundColor: `${getJobStatusColor(job.status)}20`,
                              }}
                            >
                              <Text style={{ color: getJobStatusColor(job.status), fontSize: 11, fontWeight: "600" }}>
                                {getJobStatusLabel(job.status)}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                            {job.printer?.name ?? printers.find(p => p.id === job.printerId)?.name ?? "未知印表機"} · {job.pages} 頁 × {job.copies} 份
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                              {formatDateTime(new Date(job.createdAt))}
                            </Text>
                            <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                              ${job.cost}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {job.status === "printing" && (
                        <View
                          style={{
                            padding: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor: "#F59E0B15",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <Ionicons name="time" size={20} color="#F59E0B" />
                          <Text style={{ color: "#F59E0B", fontWeight: "600", flex: 1 }}>
                            正在列印中，請稍候...
                          </Text>
                        </View>
                      )}

                      {job.status === "completed" && (
                        <View
                          style={{
                            padding: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor: `${theme.colors.success}15`,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                          <Text style={{ color: theme.colors.success, fontWeight: "600", flex: 1 }}>
                            列印完成，請前往取件
                          </Text>
                        </View>
                      )}

                      {job.status === "pending" && (
                        <Button text="取消列印" onPress={() => handleCancelJob(job.id)} />
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
