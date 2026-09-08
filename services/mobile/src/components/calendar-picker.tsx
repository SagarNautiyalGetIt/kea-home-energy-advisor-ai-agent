import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, useAppTheme } from '@/theme';

export type CalendarSelectionMode = 'day' | 'week' | 'month';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);
}

function toValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

export function CalendarPicker({ value, onChange, selectionMode = 'day' }: { value: string; onChange: (value: string) => void; selectionMode?: CalendarSelectionMode }) {
  const { colors } = useAppTheme();
  const monthOnly = selectionMode === 'month';
  const selected = useMemo(() => parseDate(value), [value]);
  const [viewDate, setViewDate] = useState(() => parseDate(value));
  const [view, setView] = useState<'days' | 'months' | 'years'>(monthOnly ? 'months' : 'days');

  const firstCell = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return first;
  }, [viewDate]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  }), [firstCell]);
  const selectedWeekStart = startOfWeek(selected).getTime();

  const move = (amount: number) => {
    setViewDate((current) => monthOnly ? new Date(current.getFullYear() + amount * (view === 'years' ? 12 : 1), current.getMonth(), 1) : view === 'years' ? new Date(current.getFullYear() + amount * 12, current.getMonth(), 1) : new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const chooseMonth = (month: number) => {
    const next = new Date(viewDate.getFullYear(), month, Math.min(selected.getDate(), new Date(viewDate.getFullYear(), month + 1, 0).getDate()));
    setViewDate(next);
    setView(monthOnly ? 'months' : 'days');
    if (selectionMode === 'month') onChange(toValue(next));
  };

  const chooseYear = (year: number) => {
    const next = new Date(year, viewDate.getMonth(), Math.min(selected.getDate(), new Date(year, viewDate.getMonth() + 1, 0).getDate()));
    setViewDate(next);
    setView(monthOnly ? 'months' : 'days');
    if (selectionMode === 'month') onChange(toValue(next));
  };

  const years = Array.from({ length: 12 }, (_, index) => viewDate.getFullYear() - 5 + index);

  return (
    <View style={[styles.calendar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Previous calendar page" hitSlop={8} onPress={() => move(-1)} style={[styles.arrow, { backgroundColor: colors.input }]}><Ionicons color={palette.violet} name="chevron-back" size={19} /></Pressable>
        {!monthOnly ? <Pressable onPress={() => setView('months')} style={[styles.selector, { backgroundColor: colors.input }]}><Text style={[styles.selectorText, { color: colors.text }]}>{months[viewDate.getMonth()]}</Text><Ionicons color={colors.textMuted} name="chevron-down" size={14} /></Pressable> : null}
        <Pressable onPress={() => setView('years')} style={[monthOnly ? styles.monthYearSelector : styles.yearSelector, { backgroundColor: colors.input }]}><Text style={[styles.selectorText, { color: colors.text }]}>{viewDate.getFullYear()}</Text><Ionicons color={colors.textMuted} name="chevron-down" size={14} /></Pressable>
        <Pressable accessibilityLabel="Next calendar page" hitSlop={8} onPress={() => move(1)} style={[styles.arrow, { backgroundColor: colors.input }]}><Ionicons color={palette.violet} name="chevron-forward" size={19} /></Pressable>
      </View>

      {view === 'months' ? <View style={styles.optionGrid}>{months.map((month, index) => <Pressable key={month} onPress={() => chooseMonth(index)} style={[styles.option, index === viewDate.getMonth() && styles.optionSelected]}><Text style={[styles.optionText, { color: index === viewDate.getMonth() ? '#FFFFFF' : colors.text }]}>{month.slice(0, 3)}</Text></Pressable>)}</View> : null}
      {view === 'years' ? <View style={styles.optionGrid}>{years.map((year) => <Pressable key={year} onPress={() => chooseYear(year)} style={[styles.option, year === viewDate.getFullYear() && styles.optionSelected]}><Text style={[styles.optionText, { color: year === viewDate.getFullYear() ? '#FFFFFF' : colors.text }]}>{year}</Text></Pressable>)}</View> : null}
      {view === 'days' ? <><View style={styles.weekdays}>{weekdays.map((day) => <Text key={day} style={[styles.weekday, { color: colors.textMuted }]}>{day}</Text>)}</View><View style={styles.days}>{days.map((date) => {
        const active = sameDay(date, selected);
        const inMonth = date.getMonth() === viewDate.getMonth();
        const inWeek = selectionMode === 'week' && startOfWeek(date).getTime() === selectedWeekStart;
        return <Pressable accessibilityLabel={date.toDateString()} key={toValue(date)} onPress={() => onChange(toValue(date))} style={[styles.day, inWeek && styles.weekSelected, active && styles.daySelected]}><Text style={[styles.dayText, { color: active ? '#FFFFFF' : inMonth ? colors.text : colors.textMuted }, !inMonth && styles.outsideText]}>{date.getDate()}</Text></Pressable>;
      })}</View></> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { width: '100%', borderWidth: 1, borderRadius: 20, padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }, arrow: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, selector: { minWidth: 0, height: 40, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, borderRadius: 11 }, yearSelector: { width: 88, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, borderRadius: 11 }, monthYearSelector: { height: 40, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 11 }, selectorText: { fontSize: 12, fontWeight: '900' },
  weekdays: { flexDirection: 'row' }, weekday: { width: '14.285%', paddingVertical: 7, fontSize: 8, fontWeight: '900', textAlign: 'center' }, days: { flexDirection: 'row', flexWrap: 'wrap' }, day: { width: '14.285%', height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, daySelected: { backgroundColor: palette.violet }, weekSelected: { backgroundColor: 'rgba(74, 37, 255, 0.13)' }, dayText: { fontSize: 12, fontWeight: '800' }, outsideText: { opacity: 0.4 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 4 }, option: { width: '31.7%', minHeight: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, optionSelected: { backgroundColor: palette.violet }, optionText: { fontSize: 12, fontWeight: '900' },
});
