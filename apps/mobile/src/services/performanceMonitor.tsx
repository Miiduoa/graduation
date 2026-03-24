/* eslint-disable */
/**
 * Performance Monitor Component
 * 用於在開發模式下顯示效能監控資訊
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { performance, PerformanceReport } from "./performance";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface PerformanceMonitorProps {
  enabled?: boolean;
}

export function PerformanceMonitor({ enabled = __DEV__ }: PerformanceMonitorProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [fps, setFps] = useState(60);

  // FPS counter
  useEffect(() => {
    if (!enabled) return;

    let frameCount = 0;
    let lastTime = Date.now();
    let animationId: number;

    const measureFps = () => {
      frameCount++;
      const currentTime = Date.now();
      
      if (currentTime - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = currentTime;
      }
      
      animationId = requestAnimationFrame(measureFps);
    };

    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
  }, [enabled]);

  // Refresh report
  const refreshReport = useCallback(() => {
    setReport(performance.getReport());
  }, []);

  useEffect(() => {
    if (isExpanded) {
      refreshReport();
      const interval = setInterval(refreshReport, 2000);
      return () => clearInterval(interval);
    }
  }, [isExpanded, refreshReport]);

  if (!enabled) return null;

  const getFpsColor = () => {
    if (fps >= 55) return "#22C55E";
    if (fps >= 30) return "#F59E0B";
    return "#EF4444";
  };

  return (
    <>
      {/* Floating Button */}
      <Pressable
        style={[styles.floatingButton, { display: isVisible ? "flex" : "none" }]}
        onPress={() => setIsExpanded(true)}
        onLongPress={() => setIsVisible(false)}
      >
        <View style={styles.fpsContainer}>
          <Text style={[styles.fpsText, { color: getFpsColor() }]}>{fps}</Text>
          <Text style={styles.fpsLabel}>FPS</Text>
        </View>
      </Pressable>

      {/* Toggle Button (always visible in dev) */}
      {!isVisible && (
        <Pressable
          style={styles.toggleButton}
          onPress={() => setIsVisible(true)}
        >
          <Ionicons name="speedometer-outline" size={20} color="#fff" />
        </Pressable>
      )}

      {/* Expanded Modal */}
      <Modal
        visible={isExpanded}
        transparent
        animationType="slide"
        onRequestClose={() => setIsExpanded(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Performance Monitor</Text>
              <Pressable onPress={() => setIsExpanded(false)}>
                <Ionicons name="close" size={24} color="#374151" />
              </Pressable>
            </View>

            <ScrollView style={styles.scrollContent}>
              {/* FPS Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Frame Rate</Text>
                <View style={styles.fpsLarge}>
                  <Text style={[styles.fpsLargeText, { color: getFpsColor() }]}>
                    {fps}
                  </Text>
                  <Text style={styles.fpsLargeLabel}>FPS</Text>
                </View>
              </View>

              {/* HTTP Stats */}
              {report && (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>HTTP Requests</Text>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Total Requests</Text>
                      <Text style={styles.statValue}>
                        {report.httpStats.totalRequests}
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Avg Duration</Text>
                      <Text style={styles.statValue}>
                        {report.httpStats.avgDuration.toFixed(0)}ms
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Error Rate</Text>
                      <Text
                        style={[
                          styles.statValue,
                          {
                            color:
                              report.httpStats.errorRate > 0.1
                                ? "#EF4444"
                                : "#22C55E",
                          },
                        ]}
                      >
                        {(report.httpStats.errorRate * 100).toFixed(1)}%
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Slow Requests ({">"}1s)</Text>
                      <Text
                        style={[
                          styles.statValue,
                          {
                            color:
                              report.httpStats.slowRequests > 0
                                ? "#F59E0B"
                                : "#22C55E",
                          },
                        ]}
                      >
                        {report.httpStats.slowRequests}
                      </Text>
                    </View>
                  </View>

                  {/* Trace Stats */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Traces</Text>
                    {report.traceStats.length === 0 ? (
                      <Text style={styles.emptyText}>No traces recorded</Text>
                    ) : (
                      report.traceStats
                        .sort((a, b) => b.avgDuration - a.avgDuration)
                        .slice(0, 10)
                        .map((stat, index) => (
                          <View key={index} style={styles.traceRow}>
                            <View style={styles.traceInfo}>
                              <Text style={styles.traceName} numberOfLines={1}>
                                {stat.name}
                              </Text>
                              <Text style={styles.traceCount}>
                                {stat.count}x
                              </Text>
                            </View>
                            <View style={styles.traceDurations}>
                              <Text style={styles.traceAvg}>
                                avg: {stat.avgDuration.toFixed(0)}ms
                              </Text>
                              <Text style={styles.traceP95}>
                                p95: {stat.p95Duration.toFixed(0)}ms
                              </Text>
                            </View>
                          </View>
                        ))
                    )}
                  </View>
                </>
              )}

              {/* Actions */}
              <View style={styles.section}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => {
                    performance.getDataStore().clear();
                    refreshReport();
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.actionButtonText}>Clear Data</Text>
                </Pressable>

                <Pressable
                  style={[styles.actionButton, { backgroundColor: "#3B82F6" }]}
                  onPress={refreshReport}
                >
                  <Ionicons name="refresh-outline" size={18} color="#fff" />
                  <Text style={styles.actionButtonText}>Refresh</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: "absolute",
    top: 50,
    right: 10,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  toggleButton: {
    position: "absolute",
    top: 50,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  fpsContainer: {
    alignItems: "center",
  },
  fpsText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  fpsLabel: {
    fontSize: 8,
    color: "#9CA3AF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1F2937",
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  fpsLarge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  fpsLargeText: {
    fontSize: 48,
    fontWeight: "bold",
  },
  fpsLargeLabel: {
    fontSize: 18,
    color: "#9CA3AF",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  statLabel: {
    fontSize: 14,
    color: "#6B7280",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F2937",
  },
  emptyText: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    paddingVertical: 20,
  },
  traceRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  traceInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  traceName: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1F2937",
    flex: 1,
    marginRight: 8,
  },
  traceCount: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  traceDurations: {
    flexDirection: "row",
    gap: 16,
  },
  traceAvg: {
    fontSize: 12,
    color: "#6B7280",
  },
  traceP95: {
    fontSize: 12,
    color: "#F59E0B",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EF4444",
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

export default PerformanceMonitor;
