import Ionicons from '@expo/vector-icons/Ionicons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { BillingDoodle } from '@/components/BillingDoodle';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { demoBillingData } from '@/data/mock';
import { billingPlaceholderInvoice, emptyBillingData, loadBillingData, type BillingInvoice, type BillingViewData } from '@/lib/billing-data';
import { invoiceHtml } from '@/lib/invoice-document';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

const money = (value: number | null | undefined) => value == null ? null : `$${value.toFixed(2)}`;

export default function BillingScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { showToast } = useToast();
  const customerId = session?.customerId ?? '';
  const [billing, setBilling] = useState<BillingViewData>(() => emptyBillingData(customerId));
  const [selected, setSelected] = useState<BillingInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadBillingData(customerId, controller.signal).then((result) => {
      if (!active) return;
      setBilling(result.data);
      setSelected(null);
      if (result.state === 'unavailable') showToast(result.message, 'warning');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [customerId, showToast]);

  const current = billing.invoices[0] ?? billingPlaceholderInvoice();
  const demoCard = demoBillingData.savedPaymentMethods[0];
  const download = async (invoice: BillingInvoice) => {
    if (!invoice.amount || documentBusy) return;
    setDocumentBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: invoiceHtml({ id: invoice.id, period: invoice.period, due: invoice.due, amount: invoice.amount, amountDue: invoice.amountDue, issued: invoice.issued, days: invoice.days, status: invoice.status, customerName: billing.customer.name, customerId: billing.customer.id, customerAddress: billing.customer.address, currentPlan: billing.customer.currentPlan, chargeLines: invoice.chargeLines, gst: invoice.gst, previousBalance: invoice.previousBalance, paymentsAndCredits: invoice.paymentsAndCredits, latePaymentFee: invoice.latePaymentFee }) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${invoice.id}` });
    } catch { showToast('The billing PDF could not be prepared.', 'warning'); }
    finally { setDocumentBusy(false); }
  };

  return <Screen>
    <PageHeader title="Billing" subtitle="Your billing information from Kea Energy." />
    {!loading && billing.invoices.length ? <Animated.View entering={FadeInUp.duration(400)}><Card style={styles.balance}>
      <BillingDoodle /><Text style={[styles.eyebrow, { color: colors.textMuted }]}>{current.status === 'Pending' ? 'Estimated charges' : 'Current balance'}</Text>
      {money(current.amountDue ?? current.amount) ? <Text style={[styles.amount, { color: colors.text }]}>{money(current.amountDue ?? current.amount)}</Text> : null}
      <Text style={[styles.status, { color: current.status === 'Paid' ? palette.green : colors.textMuted }]}>{current.status}</Text>
      {current.period ? <Text style={[styles.meta, { color: colors.textMuted }]}>{current.period}{current.days ? ` · ${current.days} days` : ''}</Text> : null}
      {current.due ? <Text style={[styles.meta, { color: colors.textMuted }]}>Due {current.due}</Text> : null}
      <View style={styles.topActions}><View style={styles.topAction}><PrimaryButton icon="eye-outline" label="View" onPress={() => setSelected(current)} variant="blue" /></View><View style={styles.topAction}><PrimaryButton icon="download-outline" label={documentBusy ? 'Preparing…' : 'Download'} onPress={() => void download(current)} variant="blue" /></View></View>
    </Card></Animated.View> : null}
    {demoCard ? <Card style={styles.cardManager}><View style={styles.cardIcon}><Ionicons color="#000000" name="card" size={22} /></View><View style={styles.cardCopy}><Text style={[styles.eyebrow, { color: colors.textMuted }]}>Default payment method</Text><Text style={[styles.cardTitle, { color: colors.text }]}>{demoCard.brand} ending in {demoCard.last4}</Text><Text style={[styles.meta, { color: colors.textMuted }]}>{demoCard.cardholder} · Expires {demoCard.expiry} · Demo</Text></View><Pressable onPress={() => setCardsOpen(true)}><Text style={styles.manage}>Manage</Text></Pressable></Card> : null}
    {!loading && !billing.invoices.length ? <Card><Text style={[styles.empty, { color: colors.textMuted }]}>No billing records are available for this account.</Text></Card> : null}
    {billing.invoices.length ? <Animated.View entering={FadeInDown.duration(400)}><SectionTitle>Billing history</SectionTitle><Card style={styles.history}>{billing.invoices.map((invoice) => <Pressable key={invoice.id} onPress={() => setSelected(invoice)} style={[styles.invoiceRow, { borderBottomColor: colors.border }]}><View style={styles.invoiceCopy}><Text style={[styles.invoicePeriod, { color: colors.text }]}>{invoice.period ?? invoice.id}</Text><Text style={[styles.meta, { color: colors.textMuted }]}>{invoice.status}{invoice.due ? ` · Due ${invoice.due}` : ''}</Text></View>{money(invoice.amount) ? <Text style={[styles.invoiceAmount, { color: colors.text }]}>{money(invoice.amount)}</Text> : null}<Ionicons color={colors.textMuted} name="chevron-forward" size={18} /></Pressable>)}</Card></Animated.View> : null}
    <ModalSheet footer={selected ? <View style={styles.footer}><PrimaryButton icon="download-outline" label={documentBusy ? 'Preparing…' : 'Download PDF'} onPress={() => void download(selected)} variant="blue" /></View> : undefined} onClose={() => setSelected(null)} title={selected?.period ?? 'Billing details'} visible={selected !== null}>{selected ? <InvoiceDetails billing={billing} invoice={selected} /> : null}</ModalSheet>
    <ModalSheet footer={<PrimaryButton label="Done" onPress={() => setCardsOpen(false)} />} onClose={() => setCardsOpen(false)} title="Manage cards" visible={cardsOpen}>{demoCard ? <View style={[styles.savedCard, { backgroundColor: colors.input, borderColor: colors.border }]}><View style={styles.cardIcon}><Ionicons color="#000000" name="card-outline" size={22} /></View><View style={styles.cardCopy}><Text style={[styles.cardTitle, { color: colors.text }]}>{demoCard.brand} ending in {demoCard.last4}</Text><Text style={[styles.meta, { color: colors.textMuted }]}>{demoCard.cardholder} · Expires {demoCard.expiry}</Text><Text style={styles.demoBadge}>DEMO CARD</Text></View></View> : null}<Text style={[styles.demoNote, { color: colors.textMuted }]}>Card management is shown with preview data. Billing totals and history above still come from the backend.</Text></ModalSheet>
  </Screen>;
}

function InvoiceDetails({ billing, invoice }: { billing: BillingViewData; invoice: BillingInvoice }) {
  const { colors } = useAppTheme();
  const facts = [['Account', billing.customer.id], ['Customer', billing.customer.name], ['Plan', billing.customer.currentPlan], ['Address', billing.customer.address], ['Issued', invoice.issued], ['Due', invoice.due], ['Period', invoice.period], ['Days', invoice.days == null ? null : String(invoice.days)]].filter((item): item is [string, string] => typeof item[1] === 'string' && item[1].length > 0);
  const totals = [['GST included', invoice.gst], ['Previous balance', invoice.previousBalance], ['Payments and credits', invoice.paymentsAndCredits], ['Late payment fee', invoice.latePaymentFee], ['Total amount', invoice.amount], ['Amount due', invoice.amountDue]].filter((item): item is [string, number] => typeof item[1] === 'number');
  return <View style={styles.details}>
    <View style={[styles.detailHero, { backgroundColor: colors.input, borderColor: colors.border }]}>{money(invoice.amountDue ?? invoice.amount) ? <Text style={[styles.detailAmount, { color: colors.text }]}>{money(invoice.amountDue ?? invoice.amount)}</Text> : null}<View style={styles.statusPill}><Text style={styles.statusPillText}>{invoice.status}</Text></View></View>
    <View style={styles.factGrid}>{facts.map(([label, value]) => <View key={label} style={[styles.factCard, { backgroundColor: colors.input, borderColor: colors.border }]}><Text style={[styles.factLabel, { color: colors.textMuted }]}>{label.toUpperCase()}</Text><Text style={[styles.factValue, { color: colors.text }]}>{value}</Text></View>)}</View>
    {invoice.chargeLines.length ? <View style={[styles.lines, { backgroundColor: colors.input, borderColor: colors.border }]}><Text style={[styles.linesTitle, { color: colors.text }]}>Charges</Text>{invoice.chargeLines.map((line, index) => <View key={`${line.label}-${index}`} style={[styles.line, { borderTopColor: colors.border }]}><View style={styles.lineCopy}><Text style={[styles.lineTitle, { color: colors.text }]}>{line.label}</Text>{line.quantity || line.rate ? <Text style={[styles.lineMeta, { color: colors.textMuted }]}>{[line.quantity, line.rate].filter(Boolean).join(' · ')}</Text> : null}</View>{money(line.amount) ? <Text style={[styles.lineAmount, { color: colors.text }]}>{money(line.amount)}</Text> : null}</View>)}</View> : null}
    {totals.length ? <View style={[styles.totalCard, { borderColor: colors.border }]}>{totals.map(([label, value], index) => <View key={label} style={[styles.totalRow, index === totals.length - 1 && styles.totalRowLast]}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.totalValue, { color: colors.text }]}>{money(value)}</Text></View>)}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  balance: { gap: 10 }, topActions: { flexDirection: 'row', gap: 10, marginTop: 4 }, topAction: { flex: 1 }, eyebrow: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }, amount: { fontSize: 34, fontWeight: '900' }, status: { fontSize: 12, fontWeight: '800' }, meta: { fontSize: 10, lineHeight: 15 }, empty: { fontSize: 12, lineHeight: 18 }, cardManager: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }, cardIcon: { width: 46, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#FFFFFF' }, cardCopy: { flex: 1 }, cardTitle: { marginTop: 2, fontSize: 14, fontWeight: '900' }, manage: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, savedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 14 }, demoBadge: { alignSelf: 'flex-start', marginTop: 7, overflow: 'hidden', borderRadius: 6, backgroundColor: '#FFFFFF', color: '#000000', paddingHorizontal: 7, paddingVertical: 3, fontSize: 8, fontWeight: '900' }, demoNote: { marginTop: 14, fontSize: 10, lineHeight: 16 }, history: { paddingVertical: 0 }, invoiceRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, paddingVertical: 12 }, invoiceCopy: { flex: 1 }, invoicePeriod: { fontSize: 13, fontWeight: '900' }, invoiceAmount: { fontSize: 14, fontWeight: '900' }, footer: { flex: 1 }, details: { gap: 14 }, detailHero: { minHeight: 118, alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderRadius: 22 }, detailAmount: { fontSize: 42, fontWeight: '900', textAlign: 'center' }, statusPill: { borderRadius: 99, backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 6 }, statusPillText: { color: '#000000', fontSize: 11, fontWeight: '900' }, factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, factCard: { width: '48.4%', minHeight: 82, justifyContent: 'space-between', borderWidth: 1, borderRadius: 16, padding: 13 }, factLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.45 }, factValue: { marginTop: 8, fontSize: 14, lineHeight: 18, fontWeight: '900' }, lines: { overflow: 'hidden', borderWidth: 1, borderRadius: 18, padding: 15 }, linesTitle: { marginBottom: 9, fontSize: 19, fontWeight: '900' }, line: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingVertical: 14 }, lineCopy: { flex: 1 }, lineTitle: { fontSize: 14, lineHeight: 18, fontWeight: '900' }, lineMeta: { marginTop: 4, fontSize: 11, lineHeight: 16 }, lineAmount: { fontSize: 16, fontWeight: '900' }, totalCard: { overflow: 'hidden', borderWidth: 1, borderRadius: 18, paddingHorizontal: 15 }, totalRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: '#333333' }, totalRowLast: { borderBottomWidth: 0 }, totalLabel: { fontSize: 12, fontWeight: '700' }, totalValue: { fontSize: 14, fontWeight: '900' },
});
