import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../ui/components';
import { adminWorkbenchStyles as styles } from './adminWorkbenchStyles';

export function AdminSurface(props: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.surface} testID={props.testID} accessibilityLabel={props.title}>
      <View>
        <Text style={styles.surfaceTitle}>{props.title}</Text>
        {props.description ? (
          <Text style={styles.surfaceDescription}>{props.description}</Text>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

export function AdminDataStatusRow(props: {
  label: string;
  value: string;
  isError?: boolean;
  onRetry?: () => void;
  isLast?: boolean;
  onPressLabel?: () => void;
}) {
  return (
    <View style={[styles.statusRow, props.isLast ? styles.statusRowLast : null]}>
      <Text style={styles.statusLabel}>{props.label}</Text>
      <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 6 }}>
        <Text
          style={[styles.statusValue, props.isError ? styles.statusValueError : null]}
          accessibilityLabel={`${props.label} ${props.value}`}
        >
          {props.value}
        </Text>
        {props.isError && props.onRetry ? (
          <Button text="重試" size="small" kind="outline" onPress={props.onRetry} />
        ) : null}
      </View>
    </View>
  );
}

export function AdminListFeedback(props: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
  children?: React.ReactNode;
}) {
  if (props.loading) {
    return <Text style={styles.mutedNote}>載入中…</Text>;
  }
  if (props.error) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={styles.inlineError} accessibilityLabel={`載入失敗 ${props.error}`}>
          載入失敗，請重試。
        </Text>
        <Button text="重新載入" kind="outline" onPress={props.onRetry} />
      </View>
    );
  }
  if (props.empty) {
    return <Text style={styles.mutedNote}>{props.emptyText}</Text>;
  }
  return <>{props.children}</>;
}
