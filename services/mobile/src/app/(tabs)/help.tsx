import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { helpFaqs } from '@/lib/help-content';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

export default function HelpScreen() {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const visibleFaqs = helpFaqs.filter((faq) => `${faq.question} ${faq.answer} ${faq.note ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Screen hue>
      <PageHeader title="Help & support" subtitle="Find answers or connect with our support team." />
      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons color={colors.textMuted} name="search-outline" size={20} /><TextInput onChangeText={setQuery} placeholder="Search help topics" placeholderTextColor={colors.textMuted} style={[styles.searchInput, { color: colors.text }]} value={query} />{query ? <Pressable onPress={() => setQuery('')}><Ionicons color={colors.textMuted} name="close-circle" size={20} /></Pressable> : null}</View>
      <SectionTitle>Frequently asked questions</SectionTitle>
      <Card style={styles.faqCard}>{visibleFaqs.length ? visibleFaqs.map((faq) => { const originalIndex = helpFaqs.indexOf(faq); const open = openIndex === originalIndex; return <Pressable key={faq.question} onPress={() => setOpenIndex(open ? null : originalIndex)} style={[styles.faq, { borderBottomColor: colors.border }]}><View style={styles.faqHeader}><Text style={[styles.question, { color: colors.text }]}>{faq.question}</Text><Ionicons color={colors.icons.ai} name={open ? 'remove' : 'add'} size={22} /></View>{open ? <><Text style={[styles.answer, { color: colors.textMuted }]}>{faq.answer}</Text>{faq.note ? <Text style={styles.note}>{faq.note}</Text> : null}</> : null}</Pressable>; }) : <View style={styles.empty}><Ionicons color={colors.textMuted} name="search-outline" size={28} /><Text style={[styles.emptyText, { color: colors.textMuted }]}>No help topics match “{query}”.</Text></View>}</Card>
      <SectionTitle>Contact Customer Care</SectionTitle>
      <View style={styles.contactGrid}><Card style={styles.contactCard}><Pressable onPress={() => router.push('/assistant')} style={styles.contact}><Ionicons color={colors.icons.ai} name="chatbubble-ellipses" size={26} /><Text style={[styles.contactTitle, { color: colors.text }]}>Ask Sparky AI</Text><Text style={[styles.contactMeta, { color: colors.textMuted }]}>Usage, bill or plan help</Text></Pressable></Card><Card style={styles.contactCard}><Pressable onPress={() => Linking.openURL('tel:0800000532').catch(() => showToast('Call Customer Care on 0800 000 532', 'info'))} style={styles.contact}><Ionicons color={colors.icons.success} name="call" size={26} /><Text style={[styles.contactTitle, { color: colors.text }]}>Call us</Text><Text style={[styles.contactMeta, { color: colors.textMuted }]}>0800 000 532{`\n`}Mon–Fri, 9am–5pm</Text></Pressable></Card><Card style={styles.contactCard}><Pressable onPress={() => Linking.openURL('mailto:support@kea-energy.example?subject=Kea%20Energy%20support').catch(() => showToast('Email support@kea-energy.example', 'info'))} style={styles.contact}><Ionicons color={colors.icons.info} name="mail" size={26} /><Text style={[styles.contactTitle, { color: colors.text }]}>Email support</Text><Text style={[styles.contactMeta, { color: colors.textMuted }]}>support@kea-energy.example</Text></Pressable></Card></View>
      <Card style={styles.emergency}><Ionicons color={palette.red} name="alert-circle" size={24} /><View style={styles.emergencyCopy}><Text style={[styles.emergencyTitle, { color: colors.text }]}>Power outage or emergency?</Text><Text style={[styles.emergencyBody, { color: colors.textMuted }]}>Contact your local lines company. For immediate danger, call 111.</Text></View></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 17, paddingHorizontal: 15 }, searchInput: { flex: 1, minHeight: 50, fontSize: 16 },
  faqCard: { paddingVertical: 0 }, faq: { borderBottomWidth: 1, paddingVertical: 16 }, faqHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, question: { flex: 1, fontSize: 14, fontWeight: '900', lineHeight: 20 }, answer: { marginTop: 10, paddingRight: 26, fontSize: 12, lineHeight: 19 }, note: { marginTop: 8, paddingRight: 26, color: palette.violet, fontSize: 12, fontWeight: '700', lineHeight: 19 }, empty: { alignItems: 'center', gap: 8, paddingVertical: 28 }, emptyText: { fontSize: 12, textAlign: 'center' },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, contactCard: { width: '48%', padding: 0 }, contact: { width: '100%', minHeight: 150, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', padding: 12 }, contactTitle: { marginTop: 10, fontSize: 14, fontWeight: '900' }, contactMeta: { marginTop: 4, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  emergency: { flexDirection: 'row', gap: 11, marginTop: 14, borderColor: '#FFD7DD' }, emergencyCopy: { flex: 1 }, emergencyTitle: { fontSize: 14, fontWeight: '900' }, emergencyBody: { marginTop: 4, fontSize: 12, lineHeight: 17 },
});
