import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FoodButton, FoodText } from './NuniFoodUi';

/** Scanning only fills the current order's credential; fulfillment is a separate confirmation. */
export function NuniPickupScanner({
  onToken,
  onCancel,
}: {
  onToken(token: string): void;
  onCancel(): void;
}) {
  const navigation = useContext(NavigationContext);
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const scanned = useRef(false);
  const opening = useRef(false);
  const callbacks = useRef({ onToken, onCancel });
  callbacks.current = { onToken, onCancel };
  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      mounted.current = false;
      setActive(false);
      callbacks.current.onCancel();
    };
    const blur = navigation?.addListener('blur', stop);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stop();
    });
    return () => {
      mounted.current = false;
      blur?.();
      subscription.remove();
    };
  }, [navigation]);
  const start = async () => {
    if (opening.current || !mounted.current) return;
    opening.current = true;
    setError('');
    try {
      const result = permission?.granted ? permission : await requestPermission();
      if (!mounted.current || navigation?.isFocused() === false) return;
      if (!result.granted) {
        setError('尚未取得相機權限。請在裝置設定開啟，或返回改用貼上憑證。');
        return;
      }
      scanned.current = false;
      setActive(true);
    } catch {
      if (mounted.current) setError('相機暫時無法開啟，請重試或返回。');
    } finally {
      opening.current = false;
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <FoodText title>掃描顧客的取餐 QR 碼</FoodText>
      <FoodText>掃描後仍需核對餐點並確認交付，不會自動完成取餐。</FoodText>
      {error ? <FoodText alert>{error}</FoodText> : null}
      {active && permission?.granted ? (
        <CameraView
          testID="food-pickup-camera"
          style={{ width: '100%', height: 280 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (scanned.current || !mounted.current) return;
            scanned.current = true;
            setActive(false);
            const value = data.trim();
            if (!/^[A-Za-z0-9_-]{32,512}$/.test(value)) {
              setError('這不是有效的取餐憑證，請掃描顧客訂單頁上的取餐 QR 碼。');
              return;
            }
            callbacks.current.onToken(value);
          }}
          onMountError={() => {
            setActive(false);
            setError('相機暫時無法開啟，請重試或返回。');
          }}
        />
      ) : (
        <FoodButton onPress={() => void start()}>開啟相機掃描</FoodButton>
      )}
      <FoodButton
        onPress={() => {
          mounted.current = false;
          setActive(false);
          onCancel();
        }}
      >
        取消掃描
      </FoodButton>
    </View>
  );
}
