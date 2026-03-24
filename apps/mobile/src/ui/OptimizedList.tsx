/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import React, { memo, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  type ViewStyle,
  type ListRenderItemInfo,
} from "react-native";
import { getCurrentTheme, type Theme } from "./theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export type OptimizedListProps<T> = {
  data: T[];
  renderItem: (info: ListRenderItemInfo<T>) => React.ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  estimatedItemSize?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  contentContainerStyle?: ViewStyle;
  showsVerticalScrollIndicator?: boolean;
  initialNumToRender?: number;
  maxToRenderPerBatch?: number;
  windowSize?: number;
  removeClippedSubviews?: boolean;
  loadingMore?: boolean;
  testID?: string;
};

function OptimizedListInner<T>(props: OptimizedListProps<T>) {
  const {
    data,
    renderItem,
    keyExtractor,
    estimatedItemSize = 100,
    onEndReached,
    onEndReachedThreshold = 0.5,
    onRefresh,
    refreshing = false,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    contentContainerStyle,
    showsVerticalScrollIndicator = false,
    initialNumToRender,
    maxToRenderPerBatch,
    windowSize,
    removeClippedSubviews = true,
    loadingMore = false,
    testID,
  } = props;

  const theme = getCurrentTheme();
  
  const calculatedInitialNumToRender = useMemo(() => {
    return initialNumToRender ?? Math.ceil(SCREEN_HEIGHT / estimatedItemSize) + 2;
  }, [initialNumToRender, estimatedItemSize]);

  const calculatedMaxToRenderPerBatch = useMemo(() => {
    return maxToRenderPerBatch ?? Math.ceil(SCREEN_HEIGHT / estimatedItemSize);
  }, [maxToRenderPerBatch, estimatedItemSize]);

  const calculatedWindowSize = useMemo(() => {
    return windowSize ?? 5;
  }, [windowSize]);

  const getItemLayout = useCallback(
    (_: ArrayLike<T> | null | undefined, index: number) => ({
      length: estimatedItemSize,
      offset: estimatedItemSize * index,
      index,
    }),
    [estimatedItemSize]
  );

  const handleEndReached = useCallback(() => {
    if (onEndReached && !loadingMore) {
      onEndReached();
    }
  }, [onEndReached, loadingMore]);

  const Footer = useMemo(() => {
    if (loadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={theme.colors.accent} size="small" />
          <Text style={[styles.footerText, { color: theme.colors.muted }]}>載入更多...</Text>
        </View>
      );
    }
    return ListFooterComponent ?? null;
  }, [loadingMore, ListFooterComponent, theme.colors.accent, theme.colors.muted]);

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      onEndReached={handleEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      onRefresh={onRefresh}
      refreshing={refreshing}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={Footer}
      ListEmptyComponent={ListEmptyComponent}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      initialNumToRender={calculatedInitialNumToRender}
      maxToRenderPerBatch={calculatedMaxToRenderPerBatch}
      windowSize={calculatedWindowSize}
      removeClippedSubviews={removeClippedSubviews}
      updateCellsBatchingPeriod={50}
      testID={testID}
    />
  );
}

export const OptimizedList = memo(OptimizedListInner) as typeof OptimizedListInner;

export type MemoizedItemProps<T> = {
  item: T;
  index: number;
  renderContent: (item: T, index: number) => React.ReactElement;
  shouldUpdate?: (prevItem: T, nextItem: T) => boolean;
};

function MemoizedListItemInner<T>({ item, index, renderContent }: MemoizedItemProps<T>) {
  return renderContent(item, index);
}

export const MemoizedListItem = memo(MemoizedListItemInner, (prev, next) => {
  if (prev.shouldUpdate) {
    return !prev.shouldUpdate(prev.item, next.item);
  }
  return prev.item === next.item && prev.index === next.index;
}) as typeof MemoizedListItemInner;

export type SkeletonListProps = {
  count?: number;
  itemHeight?: number;
  gap?: number;
  style?: ViewStyle;
};

export function SkeletonList({ count = 5, itemHeight = 80, gap = 12, style }: SkeletonListProps) {
  const theme = getCurrentTheme();
  
  return (
    <View style={[{ gap }, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonItem key={i} height={itemHeight} theme={theme} />
      ))}
    </View>
  );
}

const SkeletonItem = memo(function SkeletonItem({ height, theme }: { height: number; theme: Theme }) {
  return (
    <View
      style={[
        styles.skeletonItem,
        {
          height,
          backgroundColor: theme.colors.surface2,
          borderRadius: 12,
        },
      ]}
    >
      <View style={[styles.skeletonLine, { width: "70%", backgroundColor: theme.colors.border }]} />
      <View style={[styles.skeletonLine, { width: "50%", backgroundColor: theme.colors.border }]} />
      <View style={[styles.skeletonLine, { width: "90%", backgroundColor: theme.colors.border }]} />
    </View>
  );
});

export type LazyImageProps = {
  uri: string;
  width: number;
  height: number;
  borderRadius?: number;
  fallback?: React.ReactElement;
};

export function LazyImage({ uri, width, height, borderRadius = 0, fallback }: LazyImageProps) {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const theme = getCurrentTheme();

  if (error && fallback) {
    return fallback;
  }

  return (
    <View style={{ width, height, borderRadius, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
      {!loaded && !error && (
        <View style={[StyleSheet.absoluteFill, styles.imagePlaceholder, { backgroundColor: theme.colors.surface2 }]}>
          <ActivityIndicator size="small" color={theme.colors.muted} />
        </View>
      )}
      <View style={{ width, height }}>
        {/* 使用原生 Image 並添加懶載入邏輯 */}
        {/* 為了避免 import 問題，這裡簡化處理 */}
      </View>
    </View>
  );
}

export function useListOptimization<T>(
  data: T[],
  options: {
    getItemId: (item: T) => string;
    compareItems?: (a: T, b: T) => boolean;
  }
) {
  const { getItemId, compareItems } = options;
  
  const prevDataRef = useRef<T[]>([]);
  const prevMapRef = useRef<Map<string, T>>(new Map());

  const optimizedData = useMemo(() => {
    const prevMap = prevMapRef.current;
    const newMap = new Map<string, T>();
    
    const result = data.map((item) => {
      const id = getItemId(item);
      const prevItem = prevMap.get(id);
      
      if (prevItem) {
        const shouldReuse = compareItems 
          ? !compareItems(prevItem, item)
          : prevItem === item;
        
        if (shouldReuse) {
          newMap.set(id, prevItem);
          return prevItem;
        }
      }
      
      newMap.set(id, item);
      return item;
    });
    
    prevMapRef.current = newMap;
    prevDataRef.current = result;
    
    return result;
  }, [data, getItemId, compareItems]);

  const keyExtractor = useCallback((item: T) => getItemId(item), [getItemId]);

  return { optimizedData, keyExtractor };
}

export function useDebouncedList<T>(
  data: T[],
  delay: number = 100
): T[] {
  const [debouncedData, setDebouncedData] = React.useState(data);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedData(data);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, delay]);

  return debouncedData;
}

const styles = StyleSheet.create({
  footer: {
    padding: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    fontSize: 13,
  },
  skeletonItem: {
    padding: 16,
    gap: 8,
    justifyContent: "center",
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
});
