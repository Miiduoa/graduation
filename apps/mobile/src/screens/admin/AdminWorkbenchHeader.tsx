import React from 'react';
import { Text, View } from 'react-native';
import { HeaderAvatarButton } from '../../components/HeaderAvatarButton';
import { useAdminWorkbenchStyles } from './adminWorkbenchStyles';

export function AdminWorkbenchHeader(props: {
  schoolName: string;
  schoolCode: string;
  roleLabel: string;
  accountText?: string | null;
}) {
  const styles = useAdminWorkbenchStyles();
  return (
    <View style={styles.headerRow} accessibilityRole="header">
      <HeaderAvatarButton />
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle}>管理後台</Text>
        <Text style={styles.headerSchool} accessibilityLabel={`學校 ${props.schoolName}`}>
          {props.schoolName}
          {props.schoolCode ? `（${props.schoolCode}）` : ''}
        </Text>
        <View style={styles.scopeRow}>
          <Text style={styles.roleText}>{props.roleLabel}</Text>
          {props.accountText ? (
            <Text style={styles.accountText} accessibilityLabel={`帳號 ${props.accountText}`}>
              {props.accountText}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
