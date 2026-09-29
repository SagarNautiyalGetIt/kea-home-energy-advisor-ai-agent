import Ionicons from '@expo/vector-icons/Ionicons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { PaymentCard } from '@/components/payment-card';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { billingPlaceholderInvoice, emptyBillingData, loadBillingData, type BillingInvoice, type BillingViewData } from '@/lib/billing-data';
import { invoiceHtml } from '@/lib/invoice-document';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

const money = (value: number | null | undefined) => value == null ? null : `$${value.toFixed(2)}`;

// expo-video is optional: if the user hasn't run `npx expo install expo-video` yet,
// the hero gracefully falls back to the sunset photo instead of crashing.
let ExpoVideo: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ExpoVideo = require('expo-video');
} catch {
  ExpoVideo = null;
}

function BillHeroVideo() {
  const player = ExpoVideo.useVideoPlayer(require('../../../assets/kea/bill-coins.mp4'), (p: any) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    player.loop = true;
    player.play();
    const subscription = player.addListener?.('playToEnd', () => {
      player.replay?.();
      player.play();
    });
    return () => subscription?.remove?.();
  }, [player]);
  return (
    <ExpoVideo.VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

export default function BillingScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { showToast } = useToast();
  const customerId = session?.customerId ?? '';
  const [billing, setBilling] = useState<BillingViewData>(() => emptyBillingData(customerId));
  const [selected, setSelected] = useState<BillingInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentBusy, setDocumentBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadBillingData(customerId, controller.signal, session?.displayName).then((result) => {
      if (!active) return;
      setBilling(result.data);
      setSelected(null);
      if (result.state === 'unavailable') showToast(result.message, 'warning');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [customerId, session?.displayName, showToast]);

  const current = billing.invoices[0] ?? billingPlaceholderInvoice();
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
    {!loading && billing.invoices.length ? <Animated.View entering={FadeInUp.duration(400)}>
      <View style={styles.billHero}>
        <Image source={require('../../../assets/kea/bill-sunset.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {ExpoVideo ? <BillHeroVideo /> : null}
        <View style={styles.billGlassWrap}>
          <View style={styles.billGlass}>
            <View style={styles.billEyebrowRow}>
              <View style={[styles.billDot, { backgroundColor: current.status === 'Paid' ? palette.green : '#111111' }]} />
              <Text style={styles.billEyebrow}>Latest bill</Text>
            </View>
            {money(current.amountDue ?? current.amount) ? <Text style={styles.billAmount}>{money(current.amountDue ?? current.amount)}</Text> : null}
            <Text style={[styles.billStatus, { color: current.status === 'Paid' ? palette.green : 'rgba(0,0,0,0.62)' }]}>{current.status}</Text>
            {current.period ? <Text style={styles.billMeta}>{current.period}{current.days ? ` · ${current.days} days` : ''}</Text> : null}
            {current.due ? <Text style={styles.billMeta}>Due {current.due}</Text> : null}
            <View style={styles.billActions}>
              <Pressable accessibilityRole="button" onPress={() => setSelected(current)} style={({ pressed }) => [styles.billPill, styles.billPillDark, pressed && styles.pressed]}>
                <Ionicons color="#FFFFFF" name="eye-outline" size={17} />
                <Text style={[styles.billPillText, { color: '#FFFFFF' }]}>View</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => showToast('Online payment is not connected yet.', 'info')} style={({ pressed }) => [styles.billPill, styles.billPillGhost, pressed && styles.pressed]}>
                <Ionicons color="#111111" name="card-outline" size={17} />
                <Text style={[styles.billPillText, { color: '#111111' }]}>Pay</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Animated.View> : null}
    {!loading && billing.savedPaymentMethods?.map((method) => <Animated.View key={method.id} entering={FadeInDown.duration(450)} style={styles.paymentCardEntry}><PaymentCard brand={method.brand} last4={method.last4} cardholder={method.cardholder} expiry={method.expiry} /></Animated.View>)}
    <Pressable
      accessibilityRole="button"
      onPress={() => showToast('Saved payment methods are currently read only.', 'info')}
      style={({ pressed }) => [styles.savedPaymentMethodsButton, { backgroundColor: colors.input, borderColor: colors.border }, pressed && styles.pressed]}
    >
      <Ionicons color={colors.text} name="card" size={23} />
      <Text style={[styles.savedPaymentMethodsText, { color: colors.text }]}>Saved Payment Methods</Text>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
    </Pressable>
    {!loading && !billing.invoices.length ? <Card><Text style={[styles.empty, { color: colors.textMuted }]}>No billing records are available for this account.</Text></Card> : null}
    {billing.invoices.length ? <Animated.View entering={FadeInDown.duration(400)}><SectionTitle>Billing history</SectionTitle><Card style={styles.history}>{billing.invoices.map((invoice) => <Pressable key={invoice.id} onPress={() => setSelected(invoice)} style={[styles.invoiceRow, { borderBottomColor: colors.border }]}><View style={styles.invoiceCopy}><Text style={[styles.invoicePeriod, { color: colors.text }]}>{invoice.period ?? invoice.id}</Text><Text style={[styles.meta, { color: colors.textMuted }]}>{invoice.status}{invoice.due ? ` · Due ${invoice.due}` : ''}</Text></View>{money(invoice.amount) ? <Text style={[styles.invoiceAmount, { color: colors.text }]}>{money(invoice.amount)}</Text> : null}<Ionicons color={colors.textMuted} name="chevron-forward" size={18} /></Pressable>)}</Card></Animated.View> : null}
    <ModalSheet footer={selected ? <View style={styles.footer}><PrimaryButton icon="download-outline" label={documentBusy ? 'Preparing…' : 'Download PDF'} onPress={() => void download(selected)} variant="blue" /></View> : undefined} onClose={() => setSelected(null)} title={selected?.period ?? 'Billing details'} visible={selected !== null}>{selected ? <InvoiceDetails billing={billing} invoice={selected} /> : null}</ModalSheet>
  </Screen>;
}

function InvoiceDetails({ billing, invoice }: { billing: BillingViewData; invoice: BillingInvoice }) {
  const { colors } = useAppTheme();
  const facts = [['Account', billing.customer.id], ['Customer', billing.customer.name], ['Plan', billing.customer.currentPlan], ['Address', billing.customer.address], ['Period', invoice.period], ['Days', invoice.days == null ? null : String(invoice.days)]].filter((item): item is [string, string] => typeof item[1] === 'string' && item[1].length > 0);
  const totals = [['GST included', invoice.gst], ['Previous balance', invoice.previousBalance], ['Payments and credits', invoice.paymentsAndCredits], ['Late payment fee', invoice.latePaymentFee]].filter((item): item is [string, number] => typeof item[1] === 'number');
  return <View style={styles.details}>
    <View style={[styles.detailHero, styles.detailHeroNoBorder]}>{money(invoice.amountDue ?? invoice.amount) ? <Text style={[styles.detailAmount, { color: colors.text }]}>{money(invoice.amountDue ?? invoice.amount)}</Text> : null}<View style={styles.statusPill}><Text style={styles.statusPillText}>{invoice.status}</Text></View></View>
    <View style={styles.factGrid}>{facts.map(([label, value]) => <View key={label} style={[styles.factCard, { backgroundColor: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.1)' }]}><Text style={[styles.factLabel, { color: colors.textMuted }]}>{String(label).toUpperCase()}</Text><Text style={[styles.factValue, { color: colors.text }]}>{value}</Text></View>)}</View>
    <View style={styles.invoiceMeta}><View style={styles.invoiceIdBox}><Text style={[styles.invoiceId, { color: colors.textMuted }]}>Invoice ID <Text style={{ color: colors.text }}>· {invoice.id}</Text></Text></View><View style={styles.dateRow}>{[['Issued date', invoice.issued], ['Due date', invoice.due]].map(([label, value]) => value ? <View key={String(label)} style={styles.dateItem}><Text style={[styles.factLabel, { color: colors.textMuted }]}>{String(label).toUpperCase()}</Text><Text style={[styles.dateValue, { color: colors.text }]}>{value}</Text></View> : null)}</View></View>
    {invoice.chargeLines.length ? <View style={[styles.lines, { backgroundColor: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.14)' }]}><Text style={[styles.linesTitle, { color: colors.text }]}>Charges</Text>{invoice.chargeLines.map((line, index) => <View key={`${line.label}-${index}`} style={[styles.line, { borderTopColor: 'rgba(255,255,255,0.09)' }]}><View style={styles.lineCopy}><Text style={[styles.lineTitle, { color: colors.text }]}>{line.label}</Text>{line.quantity || line.rate ? <Text style={[styles.lineMeta, { color: colors.textMuted }]}>{[line.quantity, line.rate].filter(Boolean).join(' · ')}</Text> : null}</View>{line.label.toLowerCase() !== 'estimated electricity usage' && money(line.amount) ? <Text style={[styles.lineAmount, { color: colors.text }]}>{money(line.amount)}</Text> : null}</View>)}</View> : null}
    {totals.length ? <View><Text style={[styles.breakdownTitle, { color: colors.text }]}>Payment breakdown</Text><View style={[styles.totalCard, { backgroundColor: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.12)' }]}>{totals.map(([label, value], index) => <View key={label} style={[styles.totalRow, index === totals.length - 1 && styles.totalRowLast]}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.totalValue, { color: colors.text }]}>{money(value)}</Text></View>)}</View></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  billHero: { borderRadius: 26, overflow: 'hidden' },
  billGlassWrap: { padding: 12 },
  billGlass: { borderRadius: 20, overflow: 'hidden', backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', padding: 18 },
  billEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  billDot: { width: 7, height: 7, borderRadius: 4 },
  billEyebrow: { color: 'rgba(0,0,0,0.68)', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  billAmount: { marginTop: 8, color: '#111111', fontSize: 42, fontWeight: '900', letterSpacing: -0.5 },
  billStatus: { marginTop: 4, fontSize: 13, fontWeight: '800' },
  billMeta: { marginTop: 3, color: 'rgba(0,0,0,0.58)', fontSize: 12, lineHeight: 17 },
  billActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  billPill: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 99 },
  billPillDark: { backgroundColor: '#111111' },
  billPillGhost: { backgroundColor: 'rgba(0,0,0,0.05)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.22)' },
  billPillText: { fontSize: 14, fontWeight: '800' },
  balance: { gap: 10 }, paymentCardEntry: { marginTop: 10 }, topActions: { flexDirection: 'row', gap: 10, marginTop: 4 }, topAction: { flex: 1 }, eyebrow: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase' }, amount: { fontSize: 34, fontWeight: '900' }, status: { fontSize: 12, fontWeight: '800' }, meta: { fontSize: 12, lineHeight: 18 }, empty: { fontSize: 12, lineHeight: 18 }, savedPaymentMethodsButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 15 }, savedPaymentMethodsText: { flex: 1, fontSize: 14, fontWeight: '800' }, pressed: { opacity: 0.72 }, cardManager: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }, cardIcon: { width: 46, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#D8D8D8' }, cardCopy: { flex: 1 }, cardTitle: { marginTop: 2, fontSize: 14, fontWeight: '900' }, manage: { color: '#D8D8D8', fontSize: 12, fontWeight: '900' }, savedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 14 }, demoBadge: { alignSelf: 'flex-start', marginTop: 7, overflow: 'hidden', borderRadius: 6, backgroundColor: '#D8D8D8', color: '#000000', paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, fontWeight: '900' }, demoNote: { marginTop: 14, fontSize: 12, lineHeight: 19 }, history: { paddingVertical: 0 }, invoiceRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, paddingVertical: 12 }, invoiceCopy: { flex: 1 }, invoicePeriod: { fontSize: 14, fontWeight: '900' }, invoiceAmount: { fontSize: 14, fontWeight: '900' }, footer: { flex: 1 }, details: { gap: 14 }, detailHero: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 18 }, detailAmount: { fontSize: 38, fontWeight: '900', textAlign: 'center' }, statusPill: { borderRadius: 99, backgroundColor: '#D8D8D8', paddingHorizontal: 13, paddingVertical: 6 }, statusPillText: { color: '#000000', fontSize: 12, fontWeight: '900' }, factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, factCard: { width: '48.4%', minHeight: 68, justifyContent: 'space-between', borderWidth: 1, borderRadius: 14, padding: 10 }, factLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.45 }, factValue: { marginTop: 5, fontSize: 14, lineHeight: 18, fontWeight: '900' }, lines: { overflow: 'hidden', borderWidth: 1, borderRadius: 16, padding: 13 }, linesTitle: { marginBottom: 9, fontSize: 19, fontWeight: '900' }, line: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingVertical: 14 }, lineCopy: { flex: 1 }, lineTitle: { fontSize: 14, lineHeight: 18, fontWeight: '900' }, lineMeta: { marginTop: 4, fontSize: 12, lineHeight: 17 }, lineAmount: { fontSize: 16, fontWeight: '900' }, totalCard: { overflow: 'hidden', borderWidth: 1, borderRadius: 18, paddingHorizontal: 15 }, totalRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: '#333333' }, totalRowLast: { borderBottomWidth: 0 }, totalLabel: { fontSize: 12, fontWeight: '700' }, totalValue: { fontSize: 14, fontWeight: '900' },
  invoiceMeta: { gap: 8 }, invoiceIdBox: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.025)', paddingHorizontal: 10, paddingVertical: 12 }, invoiceId: { fontSize: 14, fontWeight: '800' }, dateRow: { flexDirection: 'row', gap: 10 }, dateItem: { flex: 1, gap: 3 }, dateValue: { fontSize: 13, fontWeight: '800' }, breakdownTitle: { marginBottom: 7, fontSize: 16, fontWeight: '900' },
  paymentCard: { minHeight: 196, justifyContent: 'space-between', marginTop: 12, borderWidth: 1, borderRadius: 22, padding: 20 },
  paymentCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardBrand: { marginTop: 5, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  paymentCardChip: { width: 48, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#D8D8D8' },
  cardNumber: { marginTop: 14, fontSize: 20, fontWeight: '800', letterSpacing: 1.5 },
  paymentCardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  cardMetaLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  cardholderName: { marginTop: 4, fontSize: 14, fontWeight: '800' },
  detailHeroNoBorder: { borderWidth: 0 },
});
