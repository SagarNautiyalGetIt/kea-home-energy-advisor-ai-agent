import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { palette, useAppTheme } from '@/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

export function PrimaryButton({ label, onPress, icon, disabled = false, loading = false, variant = 'primary' }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'danger' }) {
  const { colors } = useAppTheme();
  const foreground = variant === 'secondary' ? palette.violet : palette.white;
  const content = (
    <View style={styles.buttonContent}>
      {loading ? <ActivityIndicator color={foreground} /> : icon ? <Ionicons name={icon} size={19} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </View>
  );

  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.buttonFrame, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {variant === 'primary' ? (
        <LinearGradient colors={['#765FFF', '#4A25FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>{content}</LinearGradient>
      ) : (
        <View style={[styles.buttonFill, { backgroundColor: variant === 'danger' ? palette.red : colors.surface, borderColor: variant === 'danger' ? palette.red : palette.violet, borderWidth: 1.5 }]}>{content}</View>
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function IconButton({ icon, label, onPress, selected = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; selected?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconButton, { backgroundColor: selected ? palette.violet : colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
      <Ionicons color={selected ? palette.white : palette.violet} name={icon} size={21} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, activeBackgroundColor, activeTextColor }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; activeBackgroundColor?: string; activeTextColor?: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.input }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, active && { backgroundColor: activeBackgroundColor ?? colors.surface }]}>
            <Text style={[styles.segmentText, { color: active ? activeTextColor ?? palette.violet : colors.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { colors } = useAppTheme();
  return <View style={styles.sectionTitleRow}><Text style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text>{action}</View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 22, padding: 18, shadowColor: '#263574', shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  headerCopy: { flex: 1 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -0.9 },
  subtitle: { marginTop: 5, fontSize: 14, lineHeight: 20 },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  segmented: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentText: { fontSize: 13, fontWeight: '800' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
});
