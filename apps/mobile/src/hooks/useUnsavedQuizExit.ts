import { useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';

/** Resume exactly the back action the student approved, including a native swipe. */
export function useUnsavedQuizExit(dirty: boolean, busy: boolean, draftIdentity?: unknown) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const pending = useRef<symbol | null>(null);
  useLayoutEffect(() => () => { pending.current = null; }, [dirty, busy, draftIdentity, focused]);

  usePreventRemove(focused && (dirty || busy), ({ data }) => {
    if (busy || pending.current) return;
    const confirmation = Symbol();
    pending.current = confirmation;
    const dismiss = () => {
      if (pending.current === confirmation) pending.current = null;
    };
    Alert.alert('離開這次作答？', '尚未儲存的答案會被捨棄。', [
      { text: '繼續作答', style: 'cancel', onPress: dismiss },
      {
        text: '捨棄並離開',
        style: 'destructive',
        onPress: () => {
          if (pending.current !== confirmation) return;
          dismiss();
          navigation.dispatch(data.action);
        },
      },
    ], { cancelable: true, onDismiss: dismiss });
  });
}
