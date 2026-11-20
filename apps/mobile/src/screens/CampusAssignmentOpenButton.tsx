import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import { resolveCampusAssignmentTarget, type CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';

export function CampusAssignmentOpenButton({ assignment, context, navigation, disabled }: {
  assignment: CampusAssignmentIdentity;
  context: {
    userId: string;
    schoolId: string;
    snapshot: CampusSenseSnapshot | null;
    isCurrent: () => boolean;
  };
  navigation: Parameters<typeof safeNavigate>[0];
  disabled: boolean;
}) {
  const [error, setError] = useState('');
  const input = {
    assignment, snapshot: context.snapshot,
    scope: { uid: context.userId, schoolId: context.schoolId },
  };
  const available = Boolean(resolveCampusAssignmentTarget(input));
  if (typeof navigation?.navigate !== 'function' || (!available && !error)) return null;
  return (
    <View style={{ gap: 6 }}>
      {available ? (
        <AIButton
          label="查看這份作業"
          size="sm"
          disabled={disabled}
          onPress={() => {
            if (disabled || !context.isCurrent()) return;
            const target = resolveCampusAssignmentTarget(input);
            if (!target) {
              setError('作業來源已過期或不再相符，請重新同步，或從課程總覽核對。');
              return;
            }
            setError('');
            safeNavigate(navigation, target.route, target.params);
          }}
        />
      ) : null}
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 18 }}>
        開啟後重新讀取作業與繳交狀態，不會自動送出。
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 12, lineHeight: 19 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
