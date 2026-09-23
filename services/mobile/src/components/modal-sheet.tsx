import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme';

type ModalSheetProps = {
  visible: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  keyboardAware?: boolean;
  dismissOnBackdropPress?: boolean;
  onClose: () => void;
};

export function ModalSheet({ visible, title, children, footer, keyboardAware = false, dismissOnBackdropPress = true, onClose }: ModalSheetProps) {
  const { colors } = useAppTheme();
  const handleBackdropPress = () => {
    if (dismissOnBackdropPress) {
      onClose();
      return;
    }
    Keyboard.dismiss();
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible={visible}>
      <SafeAreaView style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityLabel={dismissOnBackdropPress ? 'Close dialog' : 'Dismiss keyboard'} onPress={handleBackdropPress} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={keyboardAware ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined} pointerEvents="box-none" style={styles.keyboardAvoider}>
          <View style={[styles.sheet, { backgroundColor: colors.surfaceRaised }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Pressable accessibilityLabel="Close" hitSlop={12} onPress={onClose}><Ionicons color={colors.textMuted} name="close" size={25} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardDismissMode={keyboardAware && Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  keyboardAvoider: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 720, maxHeight: '88%', alignSelf: 'center', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8 },
  handle: { width: 46, height: 5, alignSelf: 'center', borderRadius: 3, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 12 },
  title: { flex: 1, fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  body: { paddingHorizontal: 20, paddingBottom: 22 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, borderTopWidth: 1, padding: 16 },
});
