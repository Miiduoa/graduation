/* eslint-disable */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Animated,
  Dimensions,
  LayoutAnimation,
  UIManager,
  Platform,
  FlatList,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useDataSource } from "../hooks/useDataSource";
import { useSchool } from "../state/school";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import {
  getCampusPulseSnapshot,
  submitCrowdReport,
  getLocationDetail,
  getHourlyPattern,
  type CampusPulseSnapshot,
  type PulseLocation,
  type CampusEvent,
  type PulseInsight,
  type CrowdLevel,
} from "../services/campusPulseEngine";
import { earnXP } from "../services/gamificationEngine";

if (
  UIManager.setLayoutAnimationEnabledExperimental &&
  Platform.OS === "android"
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const LOCATION_CARD_WIDTH = (SCREEN_WIDTH - theme.space.lg * 2 - theme.space.md) / 2;

interface ExpandedLocation {
  id: string;
  hourlyData: Array<{ hour: number; level: CrowdLevel }>;
}

interface ReportFeedback {
  show: boolean;
  xp: number;
}

interface CrowdOption {
  level: CrowdLevel;
  emoji: string;
  label: string;
}

const CROWD_OPTIONS: CrowdOption[] = [
  { level: 1, emoji: "😌", label: "空曠" },
  { level: 2, emoji: "🙂", label: "舒適" },
  { level: 3, emoji: "😐", label: "一般" },
  { level: 4, emoji: "😰", label: "擁擠" },
  { level: 5, emoji: "🤯", label: "爆滿" },
];

const getCrowdColor = (level: CrowdLevel): string => {
  switch (level) {
    case 1:
      return theme.colors.success;
    case 2:
      return "#84cc16";
    case 3:
      return theme.colors.warning;
    case 4:
      return "#f97316";
    case 5:
      return theme.colors.danger;
    default:
      return theme.colors.border;
  }
};

const getTrendIcon = (trend: PulseLocation["trend"]): string => {
  switch (trend) {
    case "rising":
      return "trending-up";
    case "falling":
      return "trending-down";
    case "stable":
      return "remove-outline";
    default:
      return "help-outline";
  }
};

const getTrendColor = (trend: PulseLocation["trend"]): string => {
  switch (trend) {
    case "rising":
      return theme.colors.warning;
    case "falling":
      return theme.colors.success;
    case "stable":
      return theme.colors.textSecondary;
    default:
      return theme.colors.border;
  }
};

interface BusyMeterProps {
  level: number;
}

const BusyMeter: React.FC<BusyMeterProps> = ({ level }) => {
  const percentage = Math.min(100, Math.max(0, level));
  const rotation = (percentage / 100) * 180 - 90;

  return (
    <View style={{ alignItems: "center", marginVertical: theme.space.lg }}>
      <View style={{ width: 140, height: 140, position: "relative" }}>
        {/* Meter background */}
        <View
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 70,
            borderWidth: 3,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            justifyContent: "flex-end",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          {/* Meter fill */}
          <View
            style={{
              width: "100%",
              height: `${percentage}%`,
              backgroundColor: getCrowdColor(
                percentage > 80 ? 5 : percentage > 60 ? 4 : percentage > 40 ? 3 : 2
              ),
            }}
          />
        </View>

        {/* Center needle */}
        <View
          style={{
            position: "absolute",
            width: 4,
            height: 70,
            backgroundColor: theme.colors.text,
            bottom: "50%",
            left: "50%",
            marginLeft: -2,
            borderRadius: 2,
            transform: [{ rotate: `${rotation}deg` }],
          }}
        />

        {/* Center dot */}
        <View
          style={{
            position: "absolute",
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.colors.text,
            bottom: "50%",
            left: "50%",
            marginLeft: -6,
            marginBottom: -6,
          }}
        />
      </View>

      <Text
        style={{
          fontSize: 28,
          fontWeight: "700",
          color: theme.colors.text,
          marginTop: theme.space.md,
        }}
      >
        {Math.round(percentage)}%
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: theme.colors.textSecondary,
          marginTop: theme.space.sm,
        }}
      >
        整體繁忙度
      </Text>
    </View>
  );
};

interface EventCardProps {
  event: CampusEvent;
}

const EventCard: React.FC<EventCardProps> = ({ event }) => {
  const severityColor = {
    info: theme.colors.info,
    warning: theme.colors.warning,
    alert: theme.colors.danger,
  }[event.severity];

  return (
    <View
      style={{
        width: 220,
        marginRight: theme.space.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderLeftWidth: 4,
        borderLeftColor: severityColor,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Ionicons
          name={
            event.severity === "alert"
              ? "alert-circle-outline"
              : event.severity === "warning"
              ? "warning-outline"
              : "information-circle-outline"
          }
          size={20}
          color={severityColor}
          style={{ marginRight: theme.space.sm }}
        />
        <Text
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: "600",
            color: theme.colors.text,
          }}
        >
          {event.title}
        </Text>
      </View>

      <Text
        style={{
          fontSize: 12,
          color: theme.colors.textSecondary,
          marginTop: theme.space.sm,
          lineHeight: 18,
        }}
      >
        {event.description}
      </Text>

      {event.affectedLocations && event.affectedLocations.length > 0 && (
        <View style={{ marginTop: theme.space.sm, flexDirection: "row", flexWrap: "wrap" }}>
          {event.affectedLocations.slice(0, 3).map((loc, idx) => (
            <View
              key={idx}
              style={{
                backgroundColor: severityColor + "20",
                paddingHorizontal: theme.space.sm,
                paddingVertical: 2,
                borderRadius: theme.radius.sm,
                marginRight: theme.space.sm,
                marginTop: theme.space.sm,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: severityColor,
                  fontWeight: "500",
                }}
              >
                {loc}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

interface InsightCardProps {
  insight: PulseInsight;
}

const InsightCard: React.FC<InsightCardProps> = ({ insight }) => {
  const typeConfig = {
    suggestion: { icon: "lightbulb-outline", color: theme.colors.info },
    alert: { icon: "alert-circle-outline", color: theme.colors.danger },
    trend: { icon: "trending-up", color: theme.colors.warning },
    fun_fact: { icon: "sparkles", color: theme.colors.accent },
  };

  const config = typeConfig[insight.type] || typeConfig.suggestion;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.space.md,
        marginBottom: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            backgroundColor: config.color + "20",
            justifyContent: "center",
            alignItems: "center",
            marginRight: theme.space.md,
          }}
        >
          <Ionicons name={config.icon as any} size={18} color={config.color} />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.text,
              marginBottom: theme.space.sm,
            }}
          >
            {insight.title}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textSecondary,
              lineHeight: 18,
            }}
          >
            {insight.description}
          </Text>
        </View>
      </View>
    </View>
  );
};

interface LocationCardProps {
  location: PulseLocation;
  isExpanded: boolean;
  onPress: () => void;
  hourlyData?: Array<{ hour: number; level: CrowdLevel }>;
}

const LocationCard: React.FC<LocationCardProps> = ({
  location,
  isExpanded,
  onPress,
  hourlyData,
}) => {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          padding: theme.space.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Ionicons
          name={location.icon as any}
          size={24}
          color={getCrowdColor(location.currentLevel)}
        />
        <View
          style={{
            backgroundColor: getCrowdColor(location.currentLevel) + "30",
            paddingHorizontal: theme.space.sm,
            paddingVertical: 2,
            borderRadius: theme.radius.sm,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "600",
              color: getCrowdColor(location.currentLevel),
            }}
          >
            信心度 {Math.round(location.confidence * 100)}%
          </Text>
        </View>
      </View>

      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: theme.colors.text,
          marginTop: theme.space.sm,
        }}
      >
        {location.name}
      </Text>

      {/* Crowd level dots */}
      <View style={{ flexDirection: "row", marginTop: theme.space.md, gap: theme.space.sm }}>
        {[1, 2, 3, 4, 5].map((level) => (
          <View
            key={level}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: getCrowdColor(level as CrowdLevel),
              opacity: level <= location.currentLevel ? 1 : 0.2,
            }}
          />
        ))}
      </View>

      {/* Trend and timing info */}
      <View style={{ marginTop: theme.space.md }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons
              name={getTrendIcon(location.trend) as any}
              size={16}
              color={getTrendColor(location.trend)}
              style={{ marginRight: theme.space.sm }}
            />
            <Text
              style={{
                fontSize: 12,
                color: getTrendColor(location.trend),
                fontWeight: "500",
              }}
            >
              {location.trend === "rising"
                ? "上升中"
                : location.trend === "falling"
                ? "下降中"
                : "穩定"}
            </Text>
          </View>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={theme.colors.textSecondary}
          />
        </View>

        <Text
          style={{
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginTop: theme.space.sm,
          }}
        >
          尖峰: {location.peakHours.length > 0 ? location.peakHours.join("、") : "尚無明顯尖峰"}
        </Text>
        <Text
          style={{
            fontSize: 11,
            color: theme.colors.success,
            marginTop: 2,
          }}
        >
          最佳時間: {location.bestTimeToVisit}
        </Text>
      </View>

      {/* Hourly pattern chart when expanded */}
      {isExpanded && hourlyData && (
        <View style={{ marginTop: theme.space.lg }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: theme.colors.text,
              marginBottom: theme.space.md,
            }}
          >
            每小時人潮變化
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              height: 80,
              gap: 3,
            }}
          >
            {hourlyData.map((data, idx) => {
              const isCurrentHour = new Date().getHours() === data.hour;
              const maxLevel = 5;
              const barHeight = (data.level / maxLevel) * 60;

              return (
                <View
                  key={idx}
                  style={{
                    flex: 1,
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: "100%",
                      height: barHeight,
                      backgroundColor: getCrowdColor(data.level),
                      borderRadius: theme.radius.sm,
                      borderWidth: isCurrentHour ? 2 : 0,
                      borderColor: isCurrentHour ? theme.colors.accent : "transparent",
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 9,
                      color: theme.colors.textSecondary,
                      marginTop: theme.space.sm,
                    }}
                  >
                    {data.hour}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </Pressable>
  );
};

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  locations: PulseLocation[];
  onSubmit: (locationId: string, level: CrowdLevel) => void;
}

const ReportModal: React.FC<ReportModalProps> = ({
  visible,
  onClose,
  locations,
  onSubmit,
}) => {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<CrowdLevel | null>(null);

  const handleSubmit = useCallback(() => {
    if (selectedLocation && selectedLevel) {
      onSubmit(selectedLocation, selectedLevel);
      setSelectedLocation(null);
      setSelectedLevel(null);
    }
  }, [selectedLocation, selectedLevel, onSubmit]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            padding: theme.space.lg,
            maxHeight: "80%",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: theme.space.lg,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "700",
                color: theme.colors.text,
              }}
            >
              回報人潮狀況
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons
                name="close-outline"
                size={24}
                color={theme.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Location selection */}
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: theme.colors.text,
              marginBottom: theme.space.md,
            }}
          >
            選擇位置
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: theme.space.lg }}
          >
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                onPress={() => setSelectedLocation(loc.id)}
                style={{
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    selectedLocation === loc.id
                      ? theme.colors.accent
                      : theme.colors.surface,
                  marginRight: theme.space.sm,
                  borderWidth: 1,
                  borderColor:
                    selectedLocation === loc.id
                      ? theme.colors.accent
                      : theme.colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "500",
                    color:
                      selectedLocation === loc.id
                        ? theme.colors.bg
                        : theme.colors.text,
                  }}
                >
                  {loc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Crowd level selection */}
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: theme.colors.text,
              marginBottom: theme.space.md,
            }}
          >
            目前人潮狀況
          </Text>
          <View style={{ gap: theme.space.md, marginBottom: theme.space.lg }}>
            {CROWD_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.level}
                onPress={() => setSelectedLevel(option.level)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    selectedLevel === option.level
                      ? getCrowdColor(option.level) + "20"
                      : theme.colors.surface,
                  borderWidth: 2,
                  borderColor:
                    selectedLevel === option.level
                      ? getCrowdColor(option.level)
                      : theme.colors.border,
                }}
              >
                <Text style={{ fontSize: 24, marginRight: theme.space.md }}>
                  {option.emoji}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 14,
                    fontWeight: "500",
                    color: theme.colors.text,
                  }}
                >
                  {option.label}
                </Text>
                {selectedLevel === option.level && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={getCrowdColor(option.level)}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Submit button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!selectedLocation || !selectedLevel}
            style={{
              backgroundColor:
                selectedLocation && selectedLevel
                  ? theme.colors.accent
                  : theme.colors.border,
              paddingVertical: theme.space.md,
              borderRadius: theme.radius.md,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: selectedLocation && selectedLevel ? theme.colors.bg : theme.colors.textSecondary,
              }}
            >
              提交回報
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

interface FeedbackAnimationProps {
  feedback: ReportFeedback;
  onAnimationEnd: () => void;
}

const FeedbackAnimation: React.FC<FeedbackAnimationProps> = ({
  feedback,
  onAnimationEnd,
}) => {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (feedback.show) {
      Animated.sequence([
        Animated.timing(animValue, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.delay(1200),
        Animated.timing(animValue, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => onAnimationEnd());
    }
  }, [feedback.show, animValue]);

  const opacity = animValue;
  const scale = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.1],
  });

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        marginLeft: -80,
        marginTop: -40,
        opacity,
        transform: [{ scale }],
      }}
      pointerEvents="none"
    >
      <View
        style={{
          backgroundColor: theme.colors.success,
          paddingHorizontal: theme.space.lg,
          paddingVertical: theme.space.md,
          borderRadius: theme.radius.lg,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.bg,
            textAlign: "center",
          }}
        >
          感謝回報！
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: theme.colors.bg,
            marginTop: theme.space.sm,
          }}
        >
          +{feedback.xp} XP
        </Text>
      </View>
    </Animated.View>
  );
};

export function CampusPulseScreen() {
  const insets = useSafeAreaInsets();
  const ds = useDataSource();
  const { school } = useSchool();

  const [snapshot, setSnapshot] = useState<CampusPulseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [expandedLocation, setExpandedLocation] = useState<ExpandedLocation | null>(null);
  const [feedback, setFeedback] = useState<ReportFeedback>({ show: false, xp: 0 });

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await getCampusPulseSnapshot();
      setSnapshot(data);
    } catch (error) {
      console.error("Failed to load campus pulse snapshot:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSnapshot();
  }, [loadSnapshot]);

  const handleLocationPress = useCallback(
    async (locationId: string) => {
      if (expandedLocation?.id === locationId) {
        setExpandedLocation(null);
        return;
      }

      try {
        LayoutAnimation.configureNext(
          LayoutAnimation.Presets.easeInEaseOut
        );
        const hourlyData = (await getHourlyPattern(locationId)).map((item) => ({
          hour: item.hour,
          level: Math.max(1, Math.min(5, Math.round(item.level))) as CrowdLevel,
        }));
        setExpandedLocation({ id: locationId, hourlyData });
      } catch (error) {
        console.error("Failed to load hourly pattern:", error);
      }
    },
    [expandedLocation]
  );

  const handleReportSubmit = useCallback(
    async (locationId: string, level: CrowdLevel) => {
      try {
        const location = snapshot?.locations.find((item) => item.id === locationId);
        await ds.submitPulseReport({
          schoolId: school.id,
          locationId,
          locationName: location?.name,
          category: location?.category === "dining" ? "dining" : location?.category,
          level,
        });
        const xpResult = await earnXP("report_crowd");

        setFeedback({ show: true, xp: xpResult.xpGained || 5 });
        setReportModalVisible(false);

        // Reload snapshot after report
        setTimeout(() => {
          loadSnapshot();
        }, 500);
      } catch (error) {
        console.error("Failed to submit crowd report:", error);
      }
    },
    [ds, loadSnapshot, school.id, snapshot?.locations]
  );

  if (loading || !snapshot) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Ionicons
          name="radio-button-off-outline"
          size={40}
          color={theme.colors.textSecondary}
        />
        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            marginTop: theme.space.md,
          }}
        >
          加載中...
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.bg,
      }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        {/* Header */}
        <View
          style={{
            paddingHorizontal: theme.space.lg,
            paddingTop: insets.top + theme.space.lg,
            paddingBottom: theme.space.md,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 24,
                fontWeight: "700",
                color: theme.colors.text,
              }}
            >
              校園脈動
            </Text>
            <Ionicons
              name="radio-button-on"
              size={20}
              color={theme.colors.success}
            />
          </View>
        </View>

        {/* Busy Meter */}
        <BusyMeter level={snapshot.overallBusyness} />

        {/* Campus Events Banner */}
        {snapshot.events && snapshot.events.length > 0 && (
          <View
            style={{
              paddingHorizontal: theme.space.lg,
              marginBottom: theme.space.lg,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: theme.colors.text,
                marginBottom: theme.space.md,
              }}
            >
              校園事件
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
            >
              {snapshot.events.map((event, idx) => (
                <EventCard key={idx} event={event} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Smart Insights */}
        {snapshot.insights && snapshot.insights.length > 0 && (
          <View
            style={{
              paddingHorizontal: theme.space.lg,
              marginBottom: theme.space.lg,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: theme.colors.text,
                marginBottom: theme.space.md,
              }}
            >
              智慧建議
            </Text>
            {snapshot.insights.map((insight, idx) => (
              <InsightCard key={idx} insight={insight} />
            ))}
          </View>
        )}

        {/* Location Grid */}
        <View
          style={{
            paddingHorizontal: theme.space.lg,
            marginBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.text,
              marginBottom: theme.space.md,
            }}
          >
            校園位置 ({snapshot.locations.length})
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: theme.space.md,
            }}
          >
            {snapshot.locations.map((location) => (
              <View
                key={location.id}
                style={{
                  width: LOCATION_CARD_WIDTH,
                }}
              >
                <LocationCard
                  location={location}
                  isExpanded={expandedLocation?.id === location.id}
                  onPress={() => handleLocationPress(location.id)}
                  hourlyData={
                    expandedLocation?.id === location.id
                      ? expandedLocation.hourlyData
                      : undefined
                  }
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Report Modal */}
      <ReportModal
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        locations={snapshot.locations}
        onSubmit={handleReportSubmit}
      />

      {/* Feedback Animation */}
      <FeedbackAnimation
        feedback={feedback}
        onAnimationEnd={() => setFeedback({ show: false, xp: 0 })}
      />

      {/* Floating Report Button */}
      <TouchableOpacity
        onPress={() => setReportModalVisible(true)}
        style={{
          position: "absolute",
          bottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg,
          right: theme.space.lg,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.colors.accent,
          justifyContent: "center",
          alignItems: "center",
          shadowColor: theme.colors.accent,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Ionicons
          name="megaphone-outline"
          size={24}
          color={theme.colors.bg}
        />
      </TouchableOpacity>
    </View>
  );
}
