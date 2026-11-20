import React from 'react';
import { Text, View } from 'react-native';
import { Pill } from '../../ui/components';
import { HeaderAvatarButton } from '../../components/HeaderAvatarButton';
import { adminWorkbenchStyles as styles } from './adminWorkbenchStyles';

export function AdminWorkbenchHeader(props: {
  schoolName: string;
  schoolCode: string;
  roleLabel: string;
  accountText?: string | null;
}) {
  return (
    <View style={styles.headerRow} accessibilityRole="header">
      <HeaderAvatarButton />
      <View style={styles.headerCopy}>
        <Text style={styles.headerEyebrow}>學校管理</Text>
        <Text style={styles.headerTitle}>管理後台</Text>
        <Text style={styles.headerSchool} accessibilityLabel={`學校 ${props.schoolName}`}>
          {props.schoolName}
          {props.schoolCode ? `（${props.schoolCode}）` : ''}
        </Text>
        <View style={styles.scopeRow}>
          <Pill text={props.roleLabel} kind="accent" />
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
