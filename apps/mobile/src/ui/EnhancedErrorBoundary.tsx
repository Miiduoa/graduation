import React, { Component, ErrorInfo, useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import { ErrorUtils } from "react-native";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type ErrorRecoveryAction = {
  label: string;
  action: () => void | Promise<void>;
  icon?: string;
  destructive?: boolean;
};

type EnhancedErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  severity?: ErrorSeverity;
  recoveryActions?: ErrorRecoveryAction[];
  showDetails?: boolean;
  resetKeys?: unknown[];
  componentName?: string;
};

type EnhancedErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isRecovering: boolean;
  recoveryAttempts: number;
};

const MAX_AUTO_RECOVERY_ATTEMPTS = 3;

export class EnhancedErrorBoundary extends Component<
  EnhancedErrorBoundaryProps,
  EnhancedErrorBoundaryState
> {
  constructor(props: EnhancedErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isRecovering: false,
      recoveryAttempts: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<EnhancedErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    if (__DEV__) {
      console.error(`[ErrorBoundary${this.props.componentName ? `:${this.props.componentName}` : ""}] Error:`, error);
      console.error("[ErrorBoundary] Stack:", errorInfo.componentStack);
    }

    this.logError(error, errorInfo);
  }

  componentDidUpdate(prevProps: EnhancedErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKeys) {
      const prevKeys = prevProps.resetKeys || [];
      const currentKeys = this.props.resetKeys || [];
      
      // 檢查長度變化或任何元素變化
      const hasLengthChanged = prevKeys.length !== currentKeys.length;
      const hasValueChanged = currentKeys.some((key, index) => key !== prevKeys[index]);
      
      if (hasLengthChanged || hasValueChanged) {
        this.handleReset();
      }
    }
  }

  private logError = async (error: Error, errorInfo: ErrorInfo): Promise<void> => {
    try {
      const errorReport = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        componentName: this.props.componentName,
        timestamp: new Date().toISOString(),
        recoveryAttempts: this.state.recoveryAttempts,
      };
      
      console.log("[ErrorBoundary] Error report:", JSON.stringify(errorReport, null, 2));
    } catch (e) {
      console.warn("[ErrorBoundary] Failed to log error:", e);
    }
  };

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isRecovering: false,
    });
    this.props.onReset?.();
  };

  handleAutoRecovery = async (): Promise<void> => {
    if (this.state.recoveryAttempts >= MAX_AUTO_RECOVERY_ATTEMPTS) {
      console.warn("[ErrorBoundary] Max auto-recovery attempts reached");
      return;
    }

    this.setState((prev) => ({
      isRecovering: true,
      recoveryAttempts: prev.recoveryAttempts + 1,
    }));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.handleReset();
  };

  handleRecoveryAction = async (action: ErrorRecoveryAction): Promise<void> => {
    this.setState({ isRecovering: true });
    
    try {
      await action.action();
      this.handleReset();
    } catch (e) {
      console.error("[ErrorBoundary] Recovery action failed:", e);
      Alert.alert("恢復失敗", "執行恢復操作時發生錯誤");
    } finally {
      this.setState({ isRecovering: false });
    }
  };

  handleCopyError = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    const errorText = [
      `錯誤: ${error?.name}`,
      `訊息: ${error?.message}`,
      `堆疊: ${error?.stack}`,
      `元件: ${errorInfo?.componentStack}`,
    ].join("\n\n");

    try {
      await Clipboard.setStringAsync(errorText);
      Alert.alert("已複製", "錯誤資訊已複製到剪貼簿");
    } catch (e) {
      console.warn("[ErrorBoundary] Failed to copy error:", e);
      Alert.alert("複製失敗", "無法複製錯誤資訊到剪貼簿");
    }
  };

  render(): React.ReactNode {
    const { hasError, error, errorInfo, isRecovering, recoveryAttempts } = this.state;
    const { fallback, showDetails, severity = "medium", recoveryActions } = this.props;

    if (!hasError) {
      return this.props.children;
    }

    if (fallback) {
      return fallback;
    }

    const severityConfig = {
      low: {
        icon: "information-circle",
        color: "#3B82F6",
        title: "發生小問題",
        description: "這個區塊暫時無法顯示",
      },
      medium: {
        icon: "warning",
        color: "#F59E0B",
        title: "發生錯誤",
        description: "這個功能暫時無法使用",
      },
      high: {
        icon: "alert-circle",
        color: theme.colors.error,
        title: "發生嚴重錯誤",
        description: "請嘗試重新載入",
      },
      critical: {
        icon: "skull",
        color: theme.colors.danger,
        title: "發生系統錯誤",
        description: "請重新啟動應用程式",
      },
    };

    const config = severityConfig[severity];
    const canAutoRecover = recoveryAttempts < MAX_AUTO_RECOVERY_ATTEMPTS;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          padding: theme.space.lg,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: config.color + "15",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          {isRecovering ? (
            <ActivityIndicator size="large" color={config.color} />
          ) : (
            <Ionicons name={config.icon as any} size={40} color={config.color} />
          )}
        </View>

        <Text
          style={{
            color: theme.colors.text,
            fontSize: 20,
            fontWeight: "700",
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          {isRecovering ? "正在恢復..." : config.title}
        </Text>

        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 14,
            textAlign: "center",
            marginBottom: 20,
            lineHeight: 20,
            maxWidth: 280,
          }}
        >
          {config.description}
        </Text>

        {!isRecovering && (
          <View style={{ gap: 10, width: "100%", maxWidth: 280 }}>
            {canAutoRecover && severity !== "critical" && (
              <Pressable
                onPress={this.handleAutoRecovery}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  重新載入 {recoveryAttempts > 0 ? `(${recoveryAttempts}/${MAX_AUTO_RECOVERY_ATTEMPTS})` : ""}
                </Text>
              </Pressable>
            )}

            {recoveryActions?.map((action, index) => (
              <Pressable
                key={index}
                onPress={() => this.handleRecoveryAction(action)}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 20,
                  borderRadius: theme.radius.md,
                  backgroundColor: action.destructive ? theme.colors.danger + "15" : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: action.destructive ? theme.colors.danger + "30" : theme.colors.border,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {action.icon && (
                  <Ionicons
                    name={action.icon as any}
                    size={16}
                    color={action.destructive ? theme.colors.danger : theme.colors.text}
                  />
                )}
                <Text
                  style={{
                    color: action.destructive ? theme.colors.danger : theme.colors.text,
                    fontWeight: "600",
                  }}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {(showDetails || __DEV__) && error && (
          <View style={{ marginTop: 24, width: "100%", maxWidth: 320 }}>
            <Pressable
              onPress={this.handleCopyError}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <Ionicons name="bug" size={14} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                錯誤詳情（點擊複製）
              </Text>
            </Pressable>
            
            <ScrollView
              style={{
                maxHeight: 150,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.md,
                padding: 12,
              }}
            >
              <Text style={{ color: theme.colors.error, fontSize: 11, fontFamily: "monospace" }}>
                {error.name}: {error.message}
              </Text>
              {errorInfo?.componentStack && (
                <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 8, fontFamily: "monospace" }}>
                  {errorInfo.componentStack.trim().slice(0, 500)}
                  {(errorInfo.componentStack.length ?? 0) > 500 ? "..." : ""}
                </Text>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: Omit<EnhancedErrorBoundaryProps, "children">
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || "Component";
  
  const WithErrorBoundary: React.FC<P> = (props) => (
    <EnhancedErrorBoundary {...options} componentName={displayName}>
      <WrappedComponent {...props} />
    </EnhancedErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;
  
  return WithErrorBoundary;
}

export function useErrorHandler(): (error: Error) => void {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  const handleError = useCallback((e: Error) => {
    setError(e);
  }, []);

  return handleError;
}

export function AsyncErrorBoundary({
  children,
  fallback,
  onError,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}) {
  const [error, setError] = useState<Error | null>(null);
  const previousHandlerRef = useRef<((error: Error, isFatal?: boolean) => void) | null>(null);

  useEffect(() => {
    // React Native 環境：使用 ErrorUtils 來捕獲未處理的錯誤
    if (Platform.OS !== "web" && ErrorUtils) {
      const originalHandler = ErrorUtils.getGlobalHandler();
      previousHandlerRef.current = originalHandler;

      ErrorUtils.setGlobalHandler((err: Error, isFatal?: boolean) => {
        setError(err);
        onError?.(err);
        
        // 仍然呼叫原本的處理器（如果存在）
        if (originalHandler) {
          originalHandler(err, isFatal);
        }
      });

      return () => {
        // 恢復原本的處理器
        if (previousHandlerRef.current) {
          ErrorUtils.setGlobalHandler(previousHandlerRef.current);
        }
      };
    }
    
    // Web 環境：使用 window event listeners
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleError = (event: ErrorEvent) => {
        const err = new Error(event.message);
        setError(err);
        onError?.(err);
      };

      const handleRejection = (event: PromiseRejectionEvent) => {
        const err = event.reason instanceof Error 
          ? event.reason 
          : new Error(String(event.reason));
        setError(err);
        onError?.(err);
      };

      window.addEventListener("error", handleError);
      window.addEventListener("unhandledrejection", handleRejection);
      
      return () => {
        window.removeEventListener("error", handleError);
        window.removeEventListener("unhandledrejection", handleRejection);
      };
    }
  }, [onError]);

  if (error) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <View
        style={{
          padding: 16,
          backgroundColor: theme.colors.error + "10",
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.error + "30",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="warning" size={18} color={theme.colors.error} />
          <Text style={{ color: theme.colors.error, fontWeight: "600" }}>
            發生錯誤
          </Text>
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
          {error.message}
        </Text>
        <Pressable
          onPress={() => setError(null)}
          style={{ marginTop: 8 }}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>
            重試
          </Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}
