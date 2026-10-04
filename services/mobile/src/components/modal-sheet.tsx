import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme';

type ModalSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  backgroundColor?: string;
  children: ReactNode;
  footer?: ReactNode;
  keyboardAware?: boolean;
  dismissOnBackdropPress?: boolean;
  swipeToClose?: boolean;
  onClose: () => void;
};

export function ModalSheet({ visible, title, subtitle, backgroundColor, children, footer, keyboardAware = false, dismissOnBackdropPress = true, swipeToClose = false, onClose }: ModalSheetProps) {
  const { colors } = useAppTheme();
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => swipeToClose && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => { if (gesture.dy > 0) translateY.setValue(gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 90 || gesture.vy > 1.1) { onClose(); translateY.setValue(0); return; }
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 5 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
  }), [onClose, swipeToClose, translateY]);
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
          <Animated.View {...(swipeToClose ? panResponder.panHandlers : {})} style={[styles.sheet, { backgroundColor: backgroundColor ?? colors.surfaceRaised, transform: [{ translateY }] }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.header}>
              <View style={styles.headingCopy}>
                <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
              </View>
              <Pressable accessibilityLabel="Close" hitSlop={12} onPress={onClose}><Ionicons color={colors.textMuted} name="close" size={25} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardDismissMode={keyboardAware && Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View> : null}
          </Animated.View>
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
  title: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  headingCopy: { flex: 1 },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  body: { paddingHorizontal: 20, paddingBottom: 22 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, borderTopWidth: 1, padding: 16 },
});
