import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
};

export function AppleSwitch({ checked, onChange, disabled = false, label = 'Toggle setting' }: Props) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(!checked)}
      style={[styles.track, checked ? styles.trackOn : styles.trackOff, disabled && styles.disabled]}
    >
      <View style={[styles.thumb, checked ? styles.thumbOn : styles.thumbOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 50, height: 30, justifyContent: 'center', borderRadius: 15, padding: 3 },
  trackOn: { backgroundColor: '#34C759' },
  trackOff: { backgroundColor: '#D1D1D6' },
  thumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  thumbOn: { alignSelf: 'flex-end' },
  thumbOff: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.5 },
});
