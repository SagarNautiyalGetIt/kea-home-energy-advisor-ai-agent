import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { helpFaqs } from '@/lib/help-content';
import { palette, useAppTheme } from '@/theme';

export default function HelpScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const visibleFaqs = helpFaqs.filter((faq) => `${faq.question} ${faq.answer} ${faq.note ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Screen>
      <PageHeader title="Help & support" subtitle="Find answers and verified ways to get human support." />
      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons color={colors.textMuted} name="search-outline" size={20} /><TextInput onChangeText={setQuery} placeholder="Search help topics" placeholderTextColor={colors.textMuted} style={[styles.searchInput, { color: colors.text }]} value={query} />{query ? <Pressable onPress={() => setQuery('')}><Ionicons color={colors.textMuted} name="close-circle" size={20} /></Pressable> : null}</View>
      <SectionTitle>Frequently asked questions</SectionTitle>
      <Card style={styles.faqCard}>{visibleFaqs.length ? visibleFaqs.map((faq) => { const originalIndex = helpFaqs.indexOf(faq); const open = openIndex === originalIndex; return <Pressable key={faq.question} onPress={() => setOpenIndex(open ? null : originalIndex)} style={[styles.faq, { borderBottomColor: colors.border }]}><View style={styles.faqHeader}><Text style={[styles.question, { color: colors.text }]}>{faq.question}</Text><Ionicons color={palette.violet} name={open ? 'remove' : 'add'} size={22} /></View>{open ? <><Text style={[styles.answer, { color: colors.textMuted }]}>{faq.answer}</Text>{faq.note ? <Text style={styles.note}>{faq.note}</Text> : null}</> : null}</Pressable>; }) : <View style={styles.empty}><Ionicons color={colors.textMuted} name="search-outline" size={28} /><Text style={[styles.emptyText, { color: colors.textMuted }]}>No help topics match “{query}”.</Text></View>}</Card>
      <SectionTitle>Contact Customer Care</SectionTitle>
      <Card style={styles.supportNotice}><Ionicons color={colors.textMuted} name="information-circle-outline" size={23} /><View style={styles.supportCopy}><Text style={[styles.supportTitle, { color: colors.text }]}>Human support is not connected in this demo</Text><Text style={[styles.supportBody, { color: colors.textMuted }]}>No chat has been sent to staff. For account help, use the verified support details on your electricity bill.</Text></View></Card>
      <View style={styles.contactGrid}><Pressable accessibilityRole="button" onPress={() => router.push('/assistant')} style={[styles.contact, styles.contactFull, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.contactIcon}><Ionicons color={palette.violet} name="chatbubble-ellipses-outline" size={23} /></View><Text style={[styles.contactTitle, { color: colors.text }]}>Ask Sparky AI</Text><Text style={[styles.contactMeta, { color: colors.textMuted }]}>Usage, bill or plan questions</Text></Pressable></View>
      <Card style={styles.emergency}><Ionicons color={palette.red} name="alert-circle-outline" size={24} /><View style={styles.emergencyCopy}><Text style={[styles.emergencyTitle, { color: colors.text }]}>Power outage or emergency?</Text><Text style={[styles.emergencyBody, { color: colors.textMuted }]}>Contact your local lines company. For immediate danger, call 111.</Text></View></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 17, paddingHorizontal: 15 }, searchInput: { flex: 1, minHeight: 50, fontSize: 15 },
  faqCard: { paddingVertical: 0 }, faq: { borderBottomWidth: 1, paddingVertical: 16 }, faqHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, question: { flex: 1, fontSize: 13, fontWeight: '900', lineHeight: 19 }, answer: { marginTop: 10, paddingRight: 26, fontSize: 12, lineHeight: 19 }, note: { marginTop: 8, paddingRight: 26, color: palette.violet, fontSize: 11, fontWeight: '700', lineHeight: 17 }, empty: { alignItems: 'center', gap: 8, paddingVertical: 28 }, emptyText: { fontSize: 12, textAlign: 'center' },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, contact: { width: '48%', minHeight: 150, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 20, padding: 12 }, contactIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#0D0D0D' }, contactTitle: { marginTop: 10, fontSize: 14, fontWeight: '900' }, contactMeta: { marginTop: 4, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  contactFull: { width: '100%', minHeight: 112 }, supportNotice: { flexDirection: 'row', gap: 11, marginBottom: 10 }, supportCopy: { flex: 1 }, supportTitle: { fontSize: 13, fontWeight: '800' }, supportBody: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  emergency: { flexDirection: 'row', gap: 11, marginTop: 14, borderColor: '#FFD7DD' }, emergencyCopy: { flex: 1 }, emergencyTitle: { fontSize: 13, fontWeight: '900' }, emergencyBody: { marginTop: 4, fontSize: 11, lineHeight: 16 },
});
