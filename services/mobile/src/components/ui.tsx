import { tactile } from '@/lib/haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';
import { useState, type ReactNode } from 'react';
import { GlassSegmented } from '@/components/glass-segment';
import { palette, useAppTheme } from '@/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { mode } = useAppTheme();
  return (
    <View style={[styles.card, style, { backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.56)', borderColor: mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.82)' }]}>
      <BlurView intensity={mode === 'dark' ? 32 : 58} tint={mode === 'dark' ? 'dark' : 'light'} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.16)' }]} />
      <View style={styles.cardContent}>{children}</View>
    </View>
  );
}

export function PrimaryButton({ label, onPress, icon, leading, disabled = false, loading = false, variant = 'primary' }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; leading?: ReactNode; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'blue' }) {
  const { colors } = useAppTheme();
  const foreground = variant === 'danger' || variant === 'blue' ? '#FFFFFF' : variant === 'primary' ? colors.onPrimary : colors.text;
  const content = (
    <View style={styles.buttonContent}>
      {loading ? <ActivityIndicator color={foreground} /> : leading ? leading : icon ? <Ionicons name={icon} size={19} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </View>
  );

  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={() => { tactile(); onPress(); }} style={({ pressed }) => [styles.buttonFrame, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {variant === 'primary' ? (
        <View style={[styles.buttonFill, { backgroundColor: colors.primary }]}>{content}</View>
      ) : (
        <View style={[styles.buttonFill, { backgroundColor: variant === 'danger' ? palette.red : variant === 'blue' ? '#0A84FF' : colors.surface, borderColor: variant === 'danger' ? palette.red : variant === 'blue' ? '#0A84FF' : colors.primary, borderWidth: 1.5 }]}>{content}</View>
      )}
    </Pressable>
  );
}

export function FormField({ label, value, onChangeText, placeholder, error, secure = false, keyboardType = 'default', autoCapitalize = 'none', multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; error?: string; secure?: boolean; keyboardType?: KeyboardTypeOptions; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; multiline?: boolean }) {
  const { colors } = useAppTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={[styles.inputFrame, multiline && styles.multilineFrame, { backgroundColor: colors.input, borderColor: error ? palette.red : colors.border }]}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          multiline={multiline}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && !visible}
          style={[styles.input, multiline && styles.multilineInput, { color: colors.text }]}
          value={value}
        />
        {secure ? (
          <Pressable accessibilityLabel={visible ? 'Hide password' : 'Show password'} hitSlop={10} onPress={() => setVisible((current) => !current)}>
            <Ionicons color={colors.textMuted} name={visible ? 'eye-off-outline' : 'eye-outline'} size={21} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.error, { color: palette.red }]}>{error}</Text> : null}
    </View>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode; hideMenuButton?: boolean }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerAction}>{action}</View>
    </View>
  );
}

export function IconButton({ icon, label, onPress, selected = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; selected?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconButton, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
      <Ionicons color={selected ? colors.onPrimary : colors.text} name={icon} size={21} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, activeBackgroundColor, activeTextColor }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; activeBackgroundColor?: string; activeTextColor?: string }) {
  // The glass pill is now the active indicator across the app, so the legacy
  // flat-background props are kept only for API compatibility.
  void activeBackgroundColor;
  void activeTextColor;
  return <GlassSegmented accessibilityLabel="Options" height={38} onChange={onChange} options={options} value={value} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { colors } = useAppTheme();
  return <View style={styles.sectionTitleRow}><Text style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text>{action}</View>;
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: 1, borderRadius: 18, padding: 18, shadowOpacity: 0, elevation: 0 },
  cardContent: { zIndex: 1 },
  buttonFrame: { minHeight: 54, borderRadius: 17, overflow: 'hidden' },
  buttonFill: { minHeight: 54, borderRadius: 17, justifyContent: 'center', paddingHorizontal: 20 },
  buttonContent: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9 },
  buttonText: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  fieldGroup: { gap: 7 },
  label: { fontSize: 14, fontWeight: '700' },
  inputFrame: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 16 },
  input: { flex: 1, minHeight: 50, fontSize: 16 },
  multilineFrame: { minHeight: 110, alignItems: 'flex-start', paddingVertical: 10 },
  multilineInput: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: palette.red, fontSize: 12, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  homeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  title: { fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8, textAlign: 'center' },
  subtitle: { marginTop: 4, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  headerAction: { width: 42, alignItems: 'flex-end' },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  menuOverlay: { flex: 1 },
  menuCard: { position: 'absolute', width: 230, borderWidth: 1, borderRadius: 16, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  menuItemLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
});
