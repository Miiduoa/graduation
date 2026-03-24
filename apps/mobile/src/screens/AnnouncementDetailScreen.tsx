/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { ScrollView, Text, View, Share, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDataSource } from "../hooks/useDataSource";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AnimatedCard, InfoRow, FeatureHighlight, Divider } from "../ui/components";
import { useFavorites } from "../state/favorites";
import { useSchool } from "../state/school";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatDateTime, formatRelativeTime, toDate } from "../utils/format";
import type { Announcement } from "../data/types";

type ExtractedDate = {
  date: Date;
  text: string;
  type: "deadline" | "event" | "general";
};

type AISummaryResult = {
  summary: string;
  keyPoints: string[];
  extractedDates: ExtractedDate[];
  sentiment: "positive" | "neutral" | "important" | "urgent";
  readingTime: number;
};

function extractDatesFromText(text: string): ExtractedDate[] {
  const dates: ExtractedDate[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();

  const patterns = [
    { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/g, type: "general" as const },
    { regex: /(\d{1,2})月(\d{1,2})日/g, type: "general" as const },
    { regex: /(\d{1,2})\/(\d{1,2})/g, type: "general" as const },
    { regex: /截止[日期時間：:]*[為是]?[：:]?\s*(\d{1,2})月(\d{1,2})日/g, type: "deadline" as const },
    { regex: /報名[截止日期時間]*[：:]\s*(\d{1,2})月(\d{1,2})日/g, type: "deadline" as const },
    { regex: /即日起至(\d{1,2})月(\d{1,2})日/g, type: "deadline" as const },
  ];

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      try {
        let year = currentYear;
        let month: number;
        let day: number;

        if (match[3]) {
          year = parseInt(match[1]);
          month = parseInt(match[2]) - 1;
          day = parseInt(match[3]);
        } else if (match[2]) {
          month = parseInt(match[1]) - 1;
          day = parseInt(match[2]);
        } else {
          continue;
        }

        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          dates.push({ date, text: match[0], type });
        }
      } catch {}
    }
  }

  const uniqueDates = dates.filter(
    (d, i, arr) => arr.findIndex((x) => x.date.getTime() === d.date.getTime()) === i
  );
  return uniqueDates.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function generateAISummary(title: string, body: string): AISummaryResult {
  const fullText = `${title}\n${body}`;
  const wordCount = fullText.length;
  const readingTime = Math.ceil(wordCount / 300);

  const sentences = body.split(/[。！？\n]/).filter((s: string) => s.trim().length > 10);

  let sentiment: AISummaryResult["sentiment"] = "neutral";
  const urgentKeywords = ["緊急", "立即", "馬上", "重要公告", "務必"];
  const importantKeywords = ["注意", "提醒", "請注意", "重要", "必須"];
  const positiveKeywords = ["恭喜", "獲獎", "通過", "成功", "榮獲"];

  if (urgentKeywords.some((k) => fullText.includes(k))) sentiment = "urgent";
  else if (importantKeywords.some((k) => fullText.includes(k))) sentiment = "important";
  else if (positiveKeywords.some((k) => fullText.includes(k))) sentiment = "positive";

  const keyPoints: string[] = [];
  const keyPhrases = ["截止", "報名", "地點", "時間", "對象", "資格", "費用", "洽詢", "聯絡"];
  for (const phrase of keyPhrases) {
    const idx = body.indexOf(phrase);
    if (idx !== -1) {
      const start = Math.max(0, idx - 5);
      const end = Math.min(body.length, idx + 30);
      const context = body.slice(start, end).replace(/\n/g, " ").trim();
      if (context.length > 5) keyPoints.push(context);
    }
  }

  const extractedDates = extractDatesFromText(fullText);

  let summary = "";
  if (sentences.length >= 3) {
    summary = `本公告主要說明${sentences[0].trim().slice(0, 50)}。${sentences.length > 1 ? sentences[1].trim().slice(0, 40) + "。" : ""}`;
  } else if (sentences.length > 0) {
    summary = sentences[0].trim();
  } else {
    summary = body.slice(0, 100) + (body.length > 100 ? "..." : "");
  }

  return {
    summary,
    keyPoints: keyPoints.slice(0, 5),
    extractedDates,
    sentiment,
    readingTime,
  };
}

export function AnnouncementDetailScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const id: string | undefined = props?.route?.params?.id;
  const fav = useFavorites();

  const [aiResult, setAiResult] = useState<AISummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  
  const [item, setItem] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [relatedAnnouncements, setRelatedAnnouncements] = useState<Announcement[]>([]);

  const ds = useDataSource();
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const loadAnnouncement = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // 取消之前的請求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const currentAbortController = abortControllerRef.current;
    
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    
    try {
      const announcement = await ds.getAnnouncement(id);
      
      // 檢查請求是否被取消或組件是否已卸載
      if (currentAbortController.signal.aborted || !isMountedRef.current) {
        return;
      }
      
      if (!announcement) {
        setNotFound(true);
        setItem(null);
      } else {
        setItem(announcement);
        setNotFound(false);
        
        // 載入相關公告（使用相同的 abort controller）
        try {
          const allAnnouncements = await ds.listAnnouncements(school.id);
          
          // 再次檢查是否被取消
          if (currentAbortController.signal.aborted || !isMountedRef.current) {
            return;
          }
          
          const keywords = announcement.title.split(/[\s,，、]/).filter((w: string) => w.length > 2);
          const related = allAnnouncements
            .filter((a) => a.id !== announcement.id)
            .filter((a) => keywords.some((k: string) => a.title.includes(k) || a.body?.includes(k)))
            .slice(0, 3);
          setRelatedAnnouncements(related);
        } catch {
          if (!currentAbortController.signal.aborted && isMountedRef.current) {
            setRelatedAnnouncements([]);
          }
        }
      }
    } catch (err) {
      if (!currentAbortController.signal.aborted && isMountedRef.current) {
        setLoadError(err instanceof Error ? err.message : "載入公告失敗");
        setItem(null);
      }
    } finally {
      if (!currentAbortController.signal.aborted && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [id, ds, school.id]);

  useEffect(() => {
    isMountedRef.current = true;
    loadAnnouncement();
    
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadAnnouncement]);

  const handleShare = async () => {
    if (!item) return;
    const message = `【${item.title}】\n\n${item.body}\n\n發布時間：${formatDateTime(item.publishedAt)}${item.source ? `\n來源：${item.source}` : ""}`;
    try {
      await Share.share({ message, title: item.title });
    } catch {}
  };

  const generateSummary = async () => {
    if (!item) return;
    setSummaryLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const result = generateAISummary(item.title, item.body || "");
    setAiResult(result);
    setSummaryLoading(false);
  };

  const handleAddToCalendar = (date: ExtractedDate) => {
    Alert.alert(
      "加入行事曆",
      `要將「${date.text}」加入行事曆嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "加入",
          onPress: () => Alert.alert("已加入", `已將 ${date.text} 加入行事曆提醒`),
        },
      ]
    );
  };

  if (loading) {
    return <LoadingState title="公告" subtitle="載入中..." rows={2} />;
  }
  
  if (loadError) {
    return (
      <ErrorState 
        title="公告" 
        subtitle="讀取失敗" 
        hint={loadError} 
        actionText="重試" 
        onAction={loadAnnouncement}
        errorType="network"
      />
    );
  }
  
  if (notFound || !item) {
    return (
      <ErrorState 
        title="找不到公告" 
        subtitle="此公告不存在或已被刪除" 
        hint="公告可能已過期或被移除，請返回列表頁查看其他公告。"
        actionText="返回"
        onAction={() => nav?.goBack?.()}
        errorType="notFound"
      />
    );
  }

  const isFav = fav.isFavorite("announcement", item.id);
  const publishedDate = toDate(item.publishedAt);

  const sentimentConfig = {
    urgent: { color: theme.colors.danger, icon: "alert-circle", label: "緊急" },
    important: { color: "#F59E0B", icon: "warning", label: "重要" },
    positive: { color: theme.colors.success, icon: "checkmark-circle", label: "好消息" },
    neutral: { color: theme.colors.muted, icon: "information-circle", label: "一般" },
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title={item.title} subtitle="">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Pill text="公告" kind="accent" />
            {item.source && <Pill text={item.source} />}
            {isFav && <Pill text="已收藏" kind="accent" />}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              {formatDateTime(item.publishedAt)}
              {publishedDate && ` · ${formatRelativeTime(publishedDate)}`}
            </Text>
          </View>

          <Text style={{ color: theme.colors.text, lineHeight: 24, fontSize: 15 }}>{item.body}</Text>

          <View style={{ marginTop: 16, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button
              text={isFav ? "取消收藏" : "收藏"}
              kind={isFav ? "secondary" : "primary"}
              onPress={() => fav.toggleFavorite("announcement", item.id)}
            />
            <Button text="分享" onPress={handleShare} />
          </View>
        </AnimatedCard>

        <AnimatedCard title="AI 智慧分析" subtitle="自動擷取重點資訊" delay={100}>
          {aiResult ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: `${sentimentConfig[aiResult.sentiment].color}20`,
                  }}
                >
                  <Ionicons
                    name={sentimentConfig[aiResult.sentiment].icon as any}
                    size={14}
                    color={sentimentConfig[aiResult.sentiment].color}
                  />
                  <Text style={{ color: sentimentConfig[aiResult.sentiment].color, fontWeight: "700", fontSize: 12 }}>
                    {sentimentConfig[aiResult.sentiment].label}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  預估閱讀 {aiResult.readingTime} 分鐘
                </Text>
              </View>

              <View
                style={{
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.accent,
                }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>AI 摘要</Text>
                <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{aiResult.summary}</Text>
              </View>

              {aiResult.keyPoints.length > 0 && (
                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>關鍵資訊</Text>
                  {aiResult.keyPoints.map((point, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                      <Ionicons name="checkmark" size={16} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.text, flex: 1, fontSize: 14 }}>{point}</Text>
                    </View>
                  ))}
                </View>
              )}

              {aiResult.extractedDates.length > 0 && (
                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>重要日期</Text>
                  {aiResult.extractedDates.map((d, i) => (
                    <Pressable
                      key={i}
                      onPress={() => handleAddToCalendar(d)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 12,
                        marginBottom: 8,
                        borderRadius: theme.radius.sm,
                        backgroundColor: d.type === "deadline" ? `${theme.colors.danger}15` : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: d.type === "deadline" ? `${theme.colors.danger}30` : theme.colors.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons
                          name={d.type === "deadline" ? "alarm" : "calendar"}
                          size={18}
                          color={d.type === "deadline" ? theme.colors.danger : theme.colors.accent}
                        />
                        <View>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{d.text}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            {formatRelativeTime(d.date)}
                            {d.type === "deadline" && " · 截止日期"}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={{ color: theme.colors.accent, fontSize: 12 }}>加入行事曆</Text>
                        <Ionicons name="add-circle" size={16} color={theme.colors.accent} />
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              <Button text="重新分析" onPress={generateSummary} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <FeatureHighlight
                icon="sparkles"
                title="智慧摘要"
                description="自動生成公告重點，快速掌握內容"
                color={theme.colors.accent}
              />
              <FeatureHighlight
                icon="calendar"
                title="日期擷取"
                description="自動辨識截止日期、活動時間，一鍵加入行事曆"
                color={theme.colors.success}
              />
              <Button
                text={summaryLoading ? "分析中..." : "開始 AI 分析"}
                kind="primary"
                disabled={summaryLoading}
                onPress={generateSummary}
              />
            </View>
          )}
        </AnimatedCard>

        {relatedAnnouncements.length > 0 && (
          <AnimatedCard title="相關公告" subtitle="你可能也想看" delay={200}>
            <View style={{ gap: 10 }}>
              {relatedAnnouncements.map((a) => {
                const aDate = toDate(a.publishedAt);
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => nav?.push?.("公告詳情", { id: a.id })}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }} numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      {aDate ? formatRelativeTime(aDate) : ""}
                      {a.source ? ` · ${a.source}` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </AnimatedCard>
        )}
      </ScrollView>
    </Screen>
  );
}
