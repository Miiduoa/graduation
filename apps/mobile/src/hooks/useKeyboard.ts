import { useState, useEffect, useCallback, useRef } from "react";
import { Keyboard, KeyboardEvent, Platform, Animated } from "react-native";

export type KeyboardState = {
  isVisible: boolean;
  keyboardHeight: number;
  keyboardAnimatedHeight: Animated.Value;
};

/**
 * 鍵盤狀態 hook
 */
export function useKeyboard(): KeyboardState & {
  dismiss: () => void;
} {
  const [isVisible, setIsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardAnimatedHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const handleShow = (event: KeyboardEvent) => {
      setIsVisible(true);
      setKeyboardHeight(event.endCoordinates.height);
      
      Animated.timing(keyboardAnimatedHeight, {
        toValue: event.endCoordinates.height,
        duration: event.duration || 250,
        useNativeDriver: false,
      }).start();
    };

    const handleHide = (event: KeyboardEvent) => {
      setIsVisible(false);
      
      Animated.timing(keyboardAnimatedHeight, {
        toValue: 0,
        duration: event.duration || 250,
        useNativeDriver: false,
      }).start(() => {
        setKeyboardHeight(0);
      });
    };

    const showListener = Keyboard.addListener(showEvent, handleShow);
    const hideListener = Keyboard.addListener(hideEvent, handleHide);

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, [keyboardAnimatedHeight]);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  return {
    isVisible,
    keyboardHeight,
    keyboardAnimatedHeight,
    dismiss,
  };
}

/**
 * 自動避開鍵盤的 padding hook
 */
export function useKeyboardAvoidingPadding(extraPadding = 0): Animated.Value {
  const { keyboardAnimatedHeight } = useKeyboard();
  
  // 使用 useRef 確保 Animated.Value 在整個生命週期中穩定，避免記憶體洩漏
  const extraPaddingValue = useRef(new Animated.Value(extraPadding)).current;
  
  // 當 extraPadding 變化時更新值
  useEffect(() => {
    extraPaddingValue.setValue(extraPadding);
  }, [extraPadding, extraPaddingValue]);
  
  // 使用 useMemo 確保 Animated.add 的結果穩定
  const combinedValue = useRef<Animated.AnimatedAddition<number> | null>(null);
  if (!combinedValue.current) {
    combinedValue.current = Animated.add(keyboardAnimatedHeight, extraPaddingValue);
  }
  
  return combinedValue.current as Animated.Value;
}

/**
 * 當鍵盤顯示時自動滾動到輸入框
 */
export function useKeyboardAutoScroll(
  scrollViewRef: React.RefObject<{ scrollTo: (options: { y: number; animated?: boolean }) => void }>,
  inputRefs: React.RefObject<{ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }>[]
): {
  handleFocus: (index: number) => void;
} {
  const { isVisible, keyboardHeight } = useKeyboard();
  const focusedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (isVisible && focusedIndexRef.current !== null) {
      const inputRef = inputRefs[focusedIndexRef.current];
      if (inputRef?.current) {
        inputRef.current.measureInWindow((x, y, width, height) => {
          const screenHeight = require("react-native").Dimensions.get("window").height;
          const inputBottom = y + height;
          const visibleArea = screenHeight - keyboardHeight;
          
          if (inputBottom > visibleArea - 50) {
            scrollViewRef.current?.scrollTo({
              y: inputBottom - visibleArea + 100,
              animated: true,
            });
          }
        });
      }
    }
  }, [isVisible, keyboardHeight, inputRefs, scrollViewRef]);

  const handleFocus = useCallback((index: number) => {
    focusedIndexRef.current = index;
  }, []);

  return { handleFocus };
}
