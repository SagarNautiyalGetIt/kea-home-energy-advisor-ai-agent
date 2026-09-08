import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, useAppTheme } from '@/theme';

type ToastTone = 'success' | 'info' | 'warning';
type Toast = { id: number; message: string; tone: ToastTone };
type ToastContextValue = { showToast: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = (id: number) => setItems((current) => current.filter((item) => item.id !== id));
  const showToast = (message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setItems((current) => [...current, { id, message, tone }]);
    setTimeout(() => dismiss(id), 3600);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 12 }]}>
        {items.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss message: ${item.message}`}
            key={item.id}
            onPress={() => dismiss(item.id)}
            style={[
              styles.toast,
              { backgroundColor: colors.surfaceRaised, borderColor: item.tone === 'warning' ? palette.amber : item.tone === 'info' ? palette.periwinkle : palette.green },
            ]}>
            <View style={[styles.dot, { backgroundColor: item.tone === 'warning' ? palette.amber : item.tone === 'info' ? palette.periwinkle : palette.green }]} />
            <Text style={[styles.message, { color: colors.text }]}>{item.message}</Text>
          </Pressable>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, zIndex: 100, alignItems: 'center', gap: 8 },
  toast: { width: '100%', maxWidth: 520, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderLeftWidth: 4, paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#111936', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  message: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
