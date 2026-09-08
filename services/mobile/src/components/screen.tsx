import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme';

export function Screen({ children, contentStyle, onTouchStart, scroll = true }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; onTouchStart?: (event: GestureResponderEvent) => void; scroll?: boolean }) {
  const { colors } = useAppTheme();
  const content = <View onTouchStart={onTouchStart} style={[styles.content, contentStyle]}>{children}</View>;

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {content}
          </ScrollView>
        ) : content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 760, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36 },
});
