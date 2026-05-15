/* eslint-disable */
import React, { useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';

// ── 本地 in-app viewer 跳轉（取代 WebBrowser 把使用者踢回 TronClass）──
function openInApp(
  navigation: any,
  url: string,
  opts: { title?: string; kind?: 'material' | 'quiz' | 'score' | 'homework' | 'attempt'; courseName?: string } = {},
): void {
  if (navigation?.navigate) {
    navigation.navigate('CourseMaterialViewer', {
      url,
      title: opts.title ?? '在 APP 內查看',
      kind: opts.kind ?? 'material',
      courseName: opts.courseName,
    });
    return;
  }
  // navigation 不可用時才 fallback 跳系統瀏覽
  WebBrowser.openBrowserAsync(url).catch(() => {});
}

import { Card, ErrorState, LoadingState, Pill, Screen, SectionTitle } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useAsyncList } from '../hooks/useAsyncList';
import {
  tcFetchModules,
  tcFetchCourseActivities,
  tcFetchCourseExams,
  tcFetchExamSubmissions,
  tcFetchExamDetail,
  tcFetchExamAttempts,
  tcFetchHomeworkActivities,
  tcFetchHomeworkDetail,
  tcFetchHomeworkSubmissions,
  tcBuildFileViewUrl,
  tcBuildFileDownloadUrl,
  tcBuildExamViewUrl,
  tcBuildScoreUrl,
  type TCModule,
  type TCCourseActivity,
  type TCExamInfo,
  type TCExamSubmission,
  type TCExamDetail,
  type TCExamAttempt,
  type TCHomeworkDetail,
  type TCHomeworkSubmission as TCHWSubmission,
} from '../services/tronClassClient';

// ── 型別定義 ──────────────────────────────────────

type HomeworkItem = {
  id: number;
  title: string;
  end_time: string | null;
  is_closed: boolean;
  module_id: number;
  homework_submissions: number[];
  detail?: TCHomeworkDetail | null;
  submissions?: TCHWSubmission[];
};

type ExamWithDetails = TCExamInfo & {
  submission?: TCExamSubmission | null;
  detail?: TCExamDetail | null;
  attempts?: TCExamAttempt[];
};

type ModuleWithContent = {
  module: TCModule;
  materials: TCCourseActivity[];
  exams: ExamWithDetails[];
  homeworks: HomeworkItem[];
};

const SCREEN_WIDTH = Dimensions.get('window').width;

// ── 小工具 ─────────────────────────────────────

function getFileIcon(name: string): keyof typeof Ionicons.glyphMap {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'document-text-outline';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'easel-outline';
  if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.avi'))
    return 'play-circle-outline';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'document-outline';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'grid-outline';
  if (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp')
  )
    return 'image-outline';
  if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z'))
    return 'archive-outline';
  return 'attach-outline';
}

function getFileColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return '#DC2626';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return '#F59E0B';
  if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return '#7C3AED';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return '#2563EB';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return '#16A34A';
  if (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.gif')
  )
    return '#EC4899';
  return theme.colors.accent;
}

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some((ext) => lower.endsWith(ext));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

function formatFullDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// ── 圖片預覽 Modal ────────────────────────────────

function ImagePreviewModal(props: {
  visible: boolean;
  imageUrl: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable
        onPress={props.onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.9)',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View style={{ position: 'absolute', top: 60, right: 20, zIndex: 10 }}>
          <Pressable onPress={props.onClose} style={{ padding: 8 }}>
            <Ionicons name="close-circle" size={32} color="#fff" />
          </Pressable>
        </View>
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 12 }}>
          {props.title}
        </Text>
        <Image
          source={{ uri: props.imageUrl }}
          style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32, borderRadius: 12 }}
          resizeMode="contain"
        />
      </Pressable>
    </Modal>
  );
}

// ── 教材檔案卡片（支援本地預覽）──────────────────────

function MaterialCard(props: {
  activity: TCCourseActivity;
  courseId: number;
  onPreviewImage: (url: string, title: string) => void;
}) {
  const { activity, courseId, onPreviewImage } = props;
  const upload = activity.uploads[0];
  const icon = upload ? getFileIcon(upload.name) : 'document-outline';
  const color = upload ? getFileColor(upload.name) : theme.colors.accent;
  const [downloading, setDownloading] = useState(false);
  const navigation = useNavigation<any>();

  const handlePress = useCallback(async () => {
    // 沒有附件 → 仍在 APP 內 webview 開課程活動頁
    if (!upload) {
      openInApp(navigation, tcBuildFileViewUrl(courseId, activity.id), {
        title: activity.title,
        kind: 'material',
      });
      return;
    }

    // 圖片：直接預覽 (本機 Image)
    if (isImageFile(upload.name)) {
      const imageUrl = tcBuildFileDownloadUrl(upload.key);
      onPreviewImage(imageUrl, upload.name);
      return;
    }

    // 其他檔案：先嘗試本地 in-app webview / PDF 查看
    setDownloading(true);
    try {
      openInApp(navigation, tcBuildFileDownloadUrl(upload.key), {
        title: upload.name,
        kind: 'material',
      });
    } finally {
      setDownloading(false);
    }
  }, [upload, courseId, activity.id, activity.title, onPreviewImage, navigation]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={downloading}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed || downloading ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: `${color}14`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {downloading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name={icon} size={20} color={color} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}
          numberOfLines={2}
        >
          {activity.title}
        </Text>
        {upload ? (
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            {upload.name} · {formatFileSize(upload.size)}
          </Text>
        ) : null}
        {activity.start_time ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {formatDate(activity.start_time)}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        {isImageFile(upload?.name ?? '') ? (
          <Ionicons name="eye-outline" size={16} color={theme.colors.accent} />
        ) : (
          <Ionicons name="download-outline" size={16} color={theme.colors.accent} />
        )}
        <Text style={{ color: theme.colors.muted, fontSize: 9 }}>
          {isImageFile(upload?.name ?? '') ? '預覽' : '下載'}
        </Text>
      </View>
    </Pressable>
  );
}

// ── 考試成績卡片（可展開看作答紀錄）─────────────────

function ExamCard(props: { exam: ExamWithDetails; courseId: number }) {
  const navigation = useNavigation<any>();
  const { exam, courseId } = props;
  const [expanded, setExpanded] = useState(false);

  const score = exam.submission?.exam_score;
  const hasScore = typeof score === 'number';
  const isSubmitted = exam.submitted_times > 0 || (exam.submission?.submissions?.length ?? 0) > 0;
  const isEnded = exam.is_closed || (exam.end_time ? new Date(exam.end_time) < new Date() : false);

  let statusColor = theme.colors.muted;
  let statusText = '未作答';
  let statusIcon: keyof typeof Ionicons.glyphMap = 'time-outline';

  if (hasScore) {
    statusColor = score >= 60 ? '#16A34A' : '#DC2626';
    statusText = `${score} 分`;
    statusIcon = 'checkmark-circle';
  } else if (isSubmitted) {
    statusColor = '#2563EB';
    statusText = '已交卷';
    statusIcon = 'checkmark-done-outline';
  } else if (isEnded) {
    statusColor = '#DC2626';
    statusText = '已結束';
    statusIcon = 'close-circle-outline';
  } else if (exam.end_time) {
    const hoursLeft = (new Date(exam.end_time).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft > 0 && hoursLeft <= 24) {
      statusColor = '#F59E0B';
      statusText = `剩 ${Math.floor(hoursLeft)}h`;
      statusIcon = 'alarm-outline';
    } else {
      statusColor = '#F59E0B';
      statusText = `截止：${formatDate(exam.end_time)}`;
      statusIcon = 'alarm-outline';
    }
  }

  const submissions = exam.submission?.submissions ?? [];
  const detail = exam.detail;
  const attempts = exam.attempts ?? [];

  return (
    <View>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: expanded ? 14 : 14,
          borderBottomLeftRadius: expanded ? 0 : 14,
          borderBottomRightRadius: expanded ? 0 : 14,
          backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
          borderWidth: 1,
          borderColor: hasScore ? (score >= 60 ? '#16A34A30' : '#DC262630') : theme.colors.border,
          borderBottomWidth: expanded ? 0 : 1,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${statusColor}14`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={statusIcon} size={20} color={statusColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}
            numberOfLines={2}
          >
            {exam.title}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            {exam.start_time ? formatDate(exam.start_time) : ''}
            {exam.start_time && exam.end_time ? ' ~ ' : ''}
            {exam.end_time ? formatDate(exam.end_time) : ''}
          </Text>
          {exam.total_score ? (
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
              滿分 {exam.total_score} · 佔比 {exam.score_percentage}%
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: statusColor, fontWeight: '700', fontSize: hasScore ? 18 : 13 }}>
            {statusText}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.muted}
          />
        </View>
      </Pressable>

      {/* 展開的詳細資訊 */}
      {expanded && (
        <View
          style={{
            padding: 14,
            borderRadius: 14,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: hasScore ? (score >= 60 ? '#16A34A30' : '#DC262630') : theme.colors.border,
            borderTopWidth: 0,
            gap: 10,
          }}
        >
          {/* 考試基本資訊 */}
          {detail && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                考試資訊
              </Text>
              <View style={{ gap: 3 }}>
                {detail.question_count != null && (
                  <InfoRow label="題目數" value={`${detail.question_count} 題`} />
                )}
                {detail.duration_minutes != null && (
                  <InfoRow label="作答時間" value={`${detail.duration_minutes} 分鐘`} />
                )}
                {detail.max_attempts != null && (
                  <InfoRow label="最多嘗試" value={`${detail.max_attempts} 次`} />
                )}
                {detail.total_score != null && (
                  <InfoRow label="總分" value={`${detail.total_score} 分`} />
                )}
                <InfoRow label="可看答案" value={detail.show_answers ? '是' : '否'} />
              </View>
            </View>
          )}

          {/* 提交紀錄 */}
          {submissions.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                提交紀錄（{submissions.length} 次）
              </Text>
              {submissions.map((sub, idx) => (
                <View
                  key={sub.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: `${theme.colors.accent}20`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>
                      {idx + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 12 }}>
                      {formatFullDate(sub.submitted_at)}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      {sub.submit_method === 'auto' ? '自動提交' : '手動提交'}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color:
                        Number(sub.score) >= 60
                          ? '#16A34A'
                          : Number(sub.score) > 0
                            ? '#DC2626'
                            : theme.colors.muted,
                      fontWeight: '700',
                      fontSize: 15,
                    }}
                  >
                    {sub.score ?? '—'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* 作答紀錄（如果有 attempts 且含答案） */}
          {attempts.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                作答紀錄
              </Text>
              {attempts.map((attempt, idx) => (
                <View
                  key={attempt.id}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surface,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                      第 {idx + 1} 次作答
                    </Text>
                    <Text
                      style={{
                        color: (attempt.score ?? 0) >= 60 ? '#16A34A' : '#DC2626',
                        fontWeight: '700',
                        fontSize: 14,
                      }}
                    >
                      {attempt.score != null
                        ? `${attempt.score} / ${attempt.total_score ?? '?'}`
                        : '—'}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    開始：{formatFullDate(attempt.started_at)} → 提交：
                    {formatFullDate(attempt.submitted_at)}
                  </Text>

                  {/* 各題答案 */}
                  {attempt.answers && attempt.answers.length > 0 && (
                    <View style={{ gap: 3, marginTop: 4 }}>
                      {attempt.answers.map((ans, qIdx) => (
                        <View
                          key={`q-${ans.question_id}`}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            paddingVertical: 3,
                            paddingHorizontal: 6,
                            borderRadius: 6,
                            backgroundColor:
                              ans.correct === true
                                ? '#16A34A10'
                                : ans.correct === false
                                  ? '#DC262610'
                                  : 'transparent',
                          }}
                        >
                          <Ionicons
                            name={
                              ans.correct === true
                                ? 'checkmark-circle'
                                : ans.correct === false
                                  ? 'close-circle'
                                  : 'remove-circle-outline'
                            }
                            size={14}
                            color={
                              ans.correct === true
                                ? '#16A34A'
                                : ans.correct === false
                                  ? '#DC2626'
                                  : theme.colors.muted
                            }
                          />
                          <Text style={{ color: theme.colors.text, fontSize: 11, flex: 1 }}>
                            第 {qIdx + 1} 題
                          </Text>
                          <Text
                            style={{
                              color:
                                ans.score != null
                                  ? ans.score > 0
                                    ? '#16A34A'
                                    : '#DC2626'
                                  : theme.colors.muted,
                              fontSize: 11,
                              fontWeight: '600',
                            }}
                          >
                            {ans.score != null ? `${ans.score} 分` : '—'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* 最終成績 */}
          {exam.submission && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                最終成績 (
                {exam.submission.exam_score_rule === 'highest'
                  ? '取最高'
                  : exam.submission.exam_score_rule === 'latest'
                    ? '取最新'
                    : exam.submission.exam_score_rule === 'average'
                      ? '取平均'
                      : exam.submission.exam_score_rule || '—'}
                )
              </Text>
              <Text
                style={{
                  color: (exam.submission.exam_score ?? 0) >= 60 ? '#16A34A' : '#DC2626',
                  fontWeight: '800',
                  fontSize: 20,
                }}
              >
                {exam.submission.exam_score ?? '—'}
              </Text>
            </View>
          )}

          {/* 在 APP 內查看完整測驗 */}
          <Pressable
            onPress={() =>
              openInApp(navigation, tcBuildExamViewUrl(courseId, exam.id), {
                title: exam.title ?? '測驗',
                kind: 'quiz',
              })
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="open-outline" size={12} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
              在 APP 內查看
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── 作業卡片（可展開看繳交紀錄）────────────────────

function HomeworkCard(props: { hw: HomeworkItem; courseId: number }) {
  const navigation = useNavigation<any>();
  const { hw, courseId } = props;
  const [expanded, setExpanded] = useState(false);

  const hasSubmission = (hw.homework_submissions?.length ?? 0) > 0;
  const now = new Date();
  const endTime = hw.end_time ? new Date(hw.end_time) : null;
  const isOverdue = endTime ? endTime < now : false;
  const isEnded = hw.is_closed || isOverdue;

  let statusColor = theme.colors.accent;
  let statusText = '進行中';
  let statusIcon: keyof typeof Ionicons.glyphMap = 'time-outline';

  if (hasSubmission) {
    statusColor = '#16A34A';
    statusText = '已繳交';
    statusIcon = 'checkmark-circle';
  } else if (isEnded) {
    statusColor = '#DC2626';
    statusText = '已截止';
    statusIcon = 'close-circle-outline';
  } else if (endTime) {
    const hoursLeft = (endTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft <= 24 && hoursLeft > 0) {
      statusColor = '#F59E0B';
      statusText = `剩 ${Math.floor(hoursLeft)}h`;
      statusIcon = 'alarm-outline';
    }
  }

  const detail = hw.detail;
  const subs = hw.submissions ?? [];

  return (
    <View>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: 14,
          borderBottomLeftRadius: expanded ? 0 : 14,
          borderBottomRightRadius: expanded ? 0 : 14,
          backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
          borderWidth: 1,
          borderColor: hasSubmission ? '#16A34A30' : isEnded ? '#DC262620' : theme.colors.border,
          borderBottomWidth: expanded ? 0 : 1,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${statusColor}14`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={statusIcon} size={20} color={statusColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}
            numberOfLines={2}
          >
            {hw.title}
          </Text>
          {hw.end_time ? (
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
              截止：{formatDate(hw.end_time)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: statusColor, fontWeight: '700', fontSize: 13 }}>{statusText}</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.muted}
          />
        </View>
      </Pressable>

      {expanded && (
        <View
          style={{
            padding: 14,
            borderRadius: 14,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: hasSubmission ? '#16A34A30' : isEnded ? '#DC262620' : theme.colors.border,
            borderTopWidth: 0,
            gap: 8,
          }}
        >
          {/* 作業詳情 */}
          {detail && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                作業資訊
              </Text>
              {detail.description ? (
                <Text
                  style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}
                  numberOfLines={5}
                >
                  {detail.description.replace(/<[^>]*>/g, '').trim()}
                </Text>
              ) : null}
              {detail.total_score != null && (
                <InfoRow label="滿分" value={`${detail.total_score}`} />
              )}
              {detail.submission_type && (
                <InfoRow label="繳交方式" value={detail.submission_type} />
              )}
              {detail.max_submissions != null && (
                <InfoRow label="最多繳交" value={`${detail.max_submissions} 次`} />
              )}
              {detail.allow_late && <InfoRow label="允許遲交" value="是" />}
              {detail.late_penalty_percent != null && (
                <InfoRow label="遲交扣分" value={`${detail.late_penalty_percent}%`} />
              )}
              {/* 附件 */}
              {detail.attachments.length > 0 && (
                <View style={{ gap: 3, marginTop: 4 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>附件：</Text>
                  {detail.attachments.map((att) => (
                    <Pressable
                      key={att.id}
                      onPress={() => {
                        if (att.url) openInApp(navigation, att.url, { title: att.name ?? '附件', kind: 'homework' });
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Ionicons name="attach" size={12} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.accent, fontSize: 11 }}>{att.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 繳交紀錄 */}
          {subs.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                繳交紀錄（{subs.length} 次）
              </Text>
              {subs.map((sub, idx) => (
                <View
                  key={sub.id}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surface,
                    gap: 2,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.colors.text, fontSize: 12 }}>
                      第 {idx + 1} 次 · {formatFullDate(sub.submitted_at)}
                    </Text>
                    {sub.score != null && (
                      <Text
                        style={{
                          color: sub.score >= 60 ? '#16A34A' : '#DC2626',
                          fontWeight: '700',
                          fontSize: 14,
                        }}
                      >
                        {sub.score} / {sub.total_score ?? '?'}
                      </Text>
                    )}
                  </View>
                  {sub.is_late && <Text style={{ color: '#F59E0B', fontSize: 10 }}>遲交</Text>}
                  {sub.feedback && (
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                      老師評語：{sub.feedback}
                    </Text>
                  )}
                  {sub.graded_at && (
                    <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                      評分時間：{formatFullDate(sub.graded_at)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* 在 APP 內查看 */}
          <Pressable
            onPress={() =>
              openInApp(navigation, `https://tronclass.pu.edu.tw/course/${courseId}/content#/homework/${hw.id}`, {
                title: hw.title ?? '作業',
                kind: 'homework',
              })
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="open-outline" size={12} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
              在 APP 內查看
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── InfoRow ───────────────────────────────────

function InfoRow(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{props.label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>
        {props.value}
      </Text>
    </View>
  );
}

// ── 成績總覽卡片 ──────────────────────────────────

function ScoreOverview(props: { exams: ExamWithDetails[]; courseId: number }) {
  const navigation = useNavigation<any>();
  const { exams, courseId } = props;
  const scoredExams = exams.filter((e) => typeof e.submission?.exam_score === 'number');

  if (scoredExams.length === 0) return null;

  const totalScore = scoredExams.reduce((sum, e) => sum + (e.submission?.exam_score ?? 0), 0);
  const avgScore = totalScore / scoredExams.length;

  // 計算加權 vs 平均
  const hasWeights = scoredExams.some((e) => Number(e.score_percentage) > 0);
  let finalScore = avgScore;
  if (hasWeights) {
    const weighted = scoredExams.filter((e) => Number(e.score_percentage) > 0);
    const totalPct = weighted.reduce((s, e) => s + Number(e.score_percentage), 0);
    const weightedSum = weighted.reduce(
      (s, e) => s + (e.submission?.exam_score ?? 0) * Number(e.score_percentage),
      0,
    );
    if (totalPct > 0) finalScore = weightedSum / totalPct;
  }

  return (
    <Card title="成績概覽" subtitle={`${scoredExams.length} 項已評分`}>
      <View style={{ gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 14 }}>
            {hasWeights ? '加權預估成績' : '平均分數'}
          </Text>
          <Text
            style={{
              color: finalScore >= 60 ? '#16A34A' : '#DC2626',
              fontWeight: '800',
              fontSize: 24,
            }}
          >
            {finalScore.toFixed(1)}
          </Text>
        </View>

        {scoredExams.map((exam) => (
          <View
            key={exam.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 4,
            }}
          >
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>{exam.title}</Text>
              {Number(exam.score_percentage) > 0 && (
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  佔 {exam.score_percentage}%
                </Text>
              )}
            </View>
            <Text
              style={{
                color: (exam.submission?.exam_score ?? 0) >= 60 ? '#16A34A' : '#DC2626',
                fontWeight: '700',
                fontSize: 16,
              }}
            >
              {exam.submission?.exam_score}
            </Text>
          </View>
        ))}

        <Pressable
          onPress={() =>
            openInApp(navigation, tcBuildScoreUrl(courseId), {
              title: '完整成績',
              kind: 'score',
            })
          }
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            marginTop: 4,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="stats-chart-outline" size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
            在 APP 內查看完整成績
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ── 章節區塊 ────────────────────────────────────

function ModuleSection(props: {
  data: ModuleWithContent;
  courseId: number;
  isExpanded: boolean;
  onToggle: () => void;
  onPreviewImage: (url: string, title: string) => void;
}) {
  const { data, courseId, isExpanded, onToggle, onPreviewImage } = props;
  const { module: mod, materials, exams, homeworks } = data;
  const totalItems = materials.length + exams.length + homeworks.length;

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          padding: 14,
          borderRadius: 14,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: `${theme.colors.accent}14`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 14 }}>
              {mod.sort}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
              {mod.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {materials.length > 0 && <Pill text={`${materials.length} 份教材`} kind="default" />}
              {exams.length > 0 && <Pill text={`${exams.length} 項測驗`} kind="accent" />}
              {homeworks.length > 0 && <Pill text={`${homeworks.length} 份作業`} kind="default" />}
              {totalItems === 0 && <Pill text="暫無內容" kind="default" />}
            </View>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.muted}
          />
        </View>
      </Pressable>

      {isExpanded && totalItems > 0 && (
        <View style={{ gap: 8, paddingLeft: 8 }}>
          {/* 教材 */}
          {materials.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 11,
                  fontWeight: '600',
                  paddingLeft: 4,
                }}
              >
                教材
              </Text>
              {materials.map((m) => (
                <MaterialCard
                  key={`mat-${m.id}`}
                  activity={m}
                  courseId={courseId}
                  onPreviewImage={onPreviewImage}
                />
              ))}
            </View>
          )}

          {/* 作業 */}
          {homeworks.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 11,
                  fontWeight: '600',
                  paddingLeft: 4,
                }}
              >
                作業
              </Text>
              {homeworks.map((hw) => (
                <HomeworkCard key={`hw-${hw.id}`} hw={hw} courseId={courseId} />
              ))}
            </View>
          )}

          {/* 測驗 */}
          {exams.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 11,
                  fontWeight: '600',
                  paddingLeft: 4,
                }}
              >
                測驗
              </Text>
              {exams.map((e) => (
                <ExamCard key={`exam-${e.id}`} exam={e} courseId={courseId} />
              ))}
            </View>
          )}
        </View>
      )}

      {isExpanded && totalItems === 0 && (
        <View style={{ paddingLeft: 46, paddingVertical: 8 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>此章節尚無教材或測驗</Text>
        </View>
      )}
    </View>
  );
}

// ── 主畫面 ────────────────────────────────────────

export function CourseModulesScreen(props: any) {
  const nav = props?.navigation;
  const courseId = Number(props?.route?.params?.groupId ?? 0);
  const courseName = String(props?.route?.params?.groupName ?? '課程');
  const auth = useAuth();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const handlePreviewImage = useCallback((url: string, title: string) => {
    setPreviewImage({ url, title });
  }, []);

  // 載入所有資料
  const {
    items: moduleData,
    loading,
    error,
    reload,
  } = useAsyncList<ModuleWithContent>(async () => {
    if (!auth.user || !courseId || isNaN(courseId)) return [];

    // 同時抓取：模組、活動（教材）、考試、作業
    const [modules, activities, exams, rawHomeworks] = await Promise.all([
      tcFetchModules(courseId).catch(() => [] as TCModule[]),
      tcFetchCourseActivities(courseId).catch(() => [] as TCCourseActivity[]),
      tcFetchCourseExams(courseId).catch(() => [] as TCExamInfo[]),
      tcFetchHomeworkActivities(courseId).catch(() => [] as any[]),
    ]);

    // 即使 modules 為空，只要有 activities/exams/homework 仍要顯示
    // 用一個「未分類章節」collect 所有沒有 module_id 的內容
    if (modules.length === 0 && activities.length === 0 && exams.length === 0 && rawHomeworks.length === 0) {
      return [];
    }
    if (modules.length === 0) {
      modules.push({
        id: 0,
        course_id: courseId,
        name: '課程內容',
        sort: 0,
        is_hidden: false,
        syllabuses: [],
      } as TCModule);
    }

    // 批量取得考試分數 + 詳細資訊 + 作答紀錄
    const examWithDetails = await Promise.all(
      exams.map(async (exam): Promise<ExamWithDetails> => {
        const [submission, detail, attempts] = await Promise.all([
          tcFetchExamSubmissions(exam.id).catch(() => null),
          tcFetchExamDetail(courseId, exam.id).catch(() => null),
          tcFetchExamAttempts(courseId, exam.id).catch(() => [] as TCExamAttempt[]),
        ]);
        return { ...exam, submission, detail, attempts };
      }),
    );

    // 批量取得作業詳細資訊 + 繳交紀錄
    const homeworkItems: HomeworkItem[] = await Promise.all(
      rawHomeworks.map(async (hw: any): Promise<HomeworkItem> => {
        const hwId = Number(hw.id ?? 0);
        const [detail, submissions] = await Promise.all([
          tcFetchHomeworkDetail(courseId, hwId).catch(() => null),
          tcFetchHomeworkSubmissions(courseId, hwId).catch(() => [] as TCHWSubmission[]),
        ]);
        return {
          id: hwId,
          title: String(hw.title ?? ''),
          end_time: hw.end_time ?? null,
          is_closed: hw.is_closed === true,
          module_id: Number(hw.module_id ?? 0),
          homework_submissions: Array.isArray(hw.homework_submissions)
            ? hw.homework_submissions
            : [],
          detail,
          submissions,
        };
      }),
    );

    // 組合每個 module 的教材、考試、作業
    return modules
      .filter((m) => !m.is_hidden)
      .sort((a, b) => a.sort - b.sort)
      .map((mod) => {
        // mod.id === 0 是我們合成的「課程內容」分類，收所有教材/考試/作業
        const isCatchAll = mod.id === 0;
        return {
          module: mod,
          // 不再限定 type === 'material'：所有 TronClass 教材類型都顯示
          // （video / online_video / audio / web_link / page / material / page 等）
          materials: activities.filter((a) =>
            isCatchAll ? true : a.module_id === mod.id,
          ),
          exams: examWithDetails.filter((e) => (isCatchAll ? true : e.module_id === mod.id)),
          homeworks: homeworkItems.filter((h) =>
            isCatchAll ? true : h.module_id === mod.id,
          ),
        };
      })
      .filter((d) => d.materials.length > 0 || d.exams.length > 0 || d.homeworks.length > 0);
  }, [auth.user?.uid, courseId]);

  // 所有考試（跨 module）
  const allExams = useMemo(() => moduleData.flatMap((d) => d.exams), [moduleData]);

  // 統計
  const totalMaterials = useMemo(
    () => moduleData.reduce((s, d) => s + d.materials.length, 0),
    [moduleData],
  );
  const totalExams = allExams.length;
  const totalHomeworks = useMemo(
    () => moduleData.reduce((s, d) => s + d.homeworks.length, 0),
    [moduleData],
  );

  if (!auth.user) {
    return (
      <Screen>
        <Card title="教材單元" subtitle="請先登入以查看課程教材">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            登入後即可查看各課程的教材、考試與成績。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!courseId || isNaN(courseId)) {
    return (
      <Screen>
        <ErrorState
          title="教材單元"
          subtitle="缺少課程資訊"
          actionText="返回"
          onAction={() => nav?.goBack?.()}
        />
      </Screen>
    );
  }

  if (loading) {
    return <LoadingState title="教材單元" subtitle={`正在載入 ${courseName} 的教材...`} rows={4} />;
  }

  if (error) {
    return (
      <ErrorState
        title="教材單元"
        subtitle="載入教材失敗"
        hint={error}
        actionText="重試"
        onAction={reload}
      />
    );
  }

  if (moduleData.length === 0) {
    return (
      <Screen>
        <Card title={courseName} subtitle="此課程還沒上傳教材">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            老師尚未發布章節內容。你可以先看看課程公告或討論串。
          </Text>
          <Pressable
            onPress={() =>
              nav?.navigate?.('CourseDiscussion', {
                groupId: String(courseId),
                groupName: courseName,
              })
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              marginTop: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="chatbubbles-outline" size={14} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
              到課程討論看看
            </Text>
          </Pressable>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      {/* 圖片預覽 Modal */}
      {previewImage && (
        <ImagePreviewModal
          visible={!!previewImage}
          imageUrl={previewImage.url}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 14,
          padding: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        {/* 課程標題 */}
        <Card title={courseName} subtitle="課程內容">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill text={`${moduleData.length} 個章節`} kind="accent" />
            <Pill text={`${totalMaterials} 份教材`} kind="default" />
            {totalExams > 0 && <Pill text={`${totalExams} 項測驗`} kind="default" />}
            {totalHomeworks > 0 && <Pill text={`${totalHomeworks} 份作業`} kind="default" />}
          </View>
        </Card>

        {/* 成績概覽 */}
        <ScoreOverview exams={allExams} courseId={courseId} />

        {/* 章節列表 */}
        <SectionTitle text="章節與教材" />
        {moduleData.map((data) => (
          <ModuleSection
            key={data.module.id}
            data={data}
            courseId={courseId}
            isExpanded={expandedId === data.module.id}
            onToggle={() => setExpandedId(expandedId === data.module.id ? null : data.module.id)}
            onPreviewImage={handlePreviewImage}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
