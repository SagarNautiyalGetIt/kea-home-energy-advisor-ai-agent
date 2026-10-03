import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useHouseholdResource, type OutageView } from '@/lib/experience-api';
import { tactile } from '@/lib/haptics';
import { useAppTheme } from '@/theme';

export function OutageNotice() {
  const { colors } = useAppTheme();
  const { data, error } = useHouseholdResource<OutageView>('scheduled-outages');
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []));
  const upcoming = data?.snapshot?.events.filter((event) => event.status === 'scheduled' && Date.parse(event.end) > now) ?? [];
  const title = error ? 'Outage information unavailable' : data?.status === 'stale' ? 'Outage schedule needs an update' : upcoming.length ? `${upcoming.length} scheduled power ${upcoming.length === 1 ? 'outage' : 'outages'}` : 'Scheduled power outages';
  return <Pressable accessibilityRole="button" onPress={() => { tactile(); router.push('/outages'); }} style={{ marginHorizontal: 18, marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
    <Ionicons name="calendar" size={24} color={upcoming.length ? colors.icons.alert : colors.icons.info} />
    <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: '700' }}>{title}</Text><Text style={{ color: colors.textMuted, marginTop: 3, fontSize: 12 }}>{upcoming[0] ? new Date(upcoming[0].start).toLocaleString('en-NZ') : data?.status === 'current' ? 'View the latest distributor schedule' : 'Check your distributor and prepare ahead'}</Text></View>
    <Ionicons name="chevron-forward" color={colors.textMuted} size={18} />
  </Pressable>;
}
