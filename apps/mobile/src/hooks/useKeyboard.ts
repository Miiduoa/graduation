import { useState, useEffect, useCallback, useRef } from "react";
import { Keyboard, KeyboardEvent, Platform, Animated, Dimensions } from "react-native";
import { useAnimatedAddition, useAnimatedValue } from "./useAnimatedValue";

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
  const keyboardAnimatedHeight = useAnimatedValue(0);

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
  const extraPaddingValue = useAnimatedValue(extraPadding);
  
  // 當 extraPadding 變化時更新值
  useEffect(() => {
    extraPaddingValue.setValue(extraPadding);
  }, [extraPadding, extraPaddingValue]);

  return useAnimatedAddition(keyboardAnimatedHeight, extraPaddingValue) as unknown as Animated.Value;
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
          const screenHeight = Dimensions.get("window").height;
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
