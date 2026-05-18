/**
 * AttendanceMethodPicker — 教師選點名方式 / 學生看老師選什麼
 *
 * 5 種方法清單 + 每種的優缺點解釋。
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { AttendanceMethod } from '@campus/shared';

export interface MethodInfo {
  method: AttendanceMethod;
  label: string;
  emoji: string;
  description: string;
  bestFor: string;
  cons?: string;
}

export const ATTENDANCE_METHODS: MethodInfo[] = [
  {
    method: 'rotating_qr',
    label: '動態 QR Code',
    emoji: '📱',
    description: '教師螢幕每 3 秒輪轉一組 QR，學生掃描',
    bestFor: '一般課堂、防截圖外流最強',
  },
  {
    method: 'number_code',
    label: '數字密碼',
    emoji: '🔢',
    description: '教師唸 4-6 位代碼，學生輸入',
    bestFor: '相機不便或大教室',
    cons: '可能被代念',
  },
  {
    method: 'geofence',
    label: 'GPS 地理圍欄',
    emoji: '📍',
    description: '學生 GPS 距教室 ≤ 設定半徑才通過',
    bestFor: '戶外、體育課、實地課',
    cons: '室內 / 地下教室 GPS 不準',
  },
  {
    method: 'selfie_liveness',
    label: '自拍活體',
    emoji: '🤳',
    description: '學生拍自拍與註冊照比對相似度',
    bestFor: '防代簽、需確認本人到場',
    cons: '相機 + 隱私同意',
  },
  {
    method: 'multi_factor',
    label: '多重驗證',
    emoji: '🛡️',
    description: 'QR + GPS 等任 2 種同時通過',
    bestFor: '期中考 / 期末考、高利害場合',
    cons: '學生操作較久',
  },
];

interface Props {
  /** 已選的方法（單選） */
  selected?: AttendanceMethod;
  /** 多重驗證選哪幾個（multi_factor 時用） */
  multiSelected?: AttendanceMethod[];
  onSelect?: (m: AttendanceMethod) => void;
  /** 學生視角：唯讀，只顯示老師選的 */
  readonly?: boolean;
}

export default function AttendanceMethodPicker(props: Props) {
  if (props.readonly) {
    const info = ATTENDANCE_METHODS.find((m) => m.method === props.selected);
    if (!info) return null;
    return (
      <View
        style={{
          padding: 16,
          backgroundColor: '#003F8A',
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 36 }}>{info.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
            老師選擇了：{info.label}
          </Text>
          <Text style={{ color: '#E5F2FF', fontSize: 12, marginTop: 4 }}>
            {info.description}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E', marginBottom: 8 }}>
        選擇點名方式
      </Text>
      {ATTENDANCE_METHODS.map((info) => {
        const sel = props.selected === info.method;
        return (
          <Pressable
            key={info.method}
            onPress={() => props.onSelect?.(info.method)}
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              backgroundColor: sel ? '#003F8A14' : '#fff',
              borderWidth: 2,
              borderColor: sel ? '#003F8A' : '#e5e7eb',
              flexDirection: 'row',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <Text style={{ fontSize: 28 }}>{info.emoji}</Text>
            <View style={{ flex: 1 }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#1C1C1E' }}>
                  {info.label}
                </Text>
                {sel && <Ionicons name="checkmark-circle" size={20} color="#003F8A" />}
              </View>
              <Text style={{ fontSize: 12, color: '#3C3C43', marginTop: 4 }}>
                {info.description}
              </Text>
              <Text style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>
                ✓ 適合：{info.bestFor}
              </Text>
              {info.cons && (
                <Text style={{ fontSize: 11, color: '#D70015', marginTop: 2 }}>
                  ⚠ 注意：{info.cons}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
