import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { Screen } from '@/components/screen';
import { Card, FormField, IconButton, PageHeader, PrimaryButton, SectionTitle } from '@/components/ui';
import { billingPlaceholderInvoice, emptyBillingData, loadBillingData, unavailableValue, type BillingInvoice, type BillingViewData, type SavedPaymentMethod } from '@/lib/billing-data';
import { deletePaymentMethod, payInvoice, saveTokenizedPaymentMethod, tokenizePaymentCard } from '@/lib/billing-api';
import { invoiceHtml } from '@/lib/invoice-document';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

type Invoice = BillingInvoice;
type Mode = 'preview' | 'payment' | 'card' | 'add-card' | 'delete-card' | null;
type PaymentCard = SavedPaymentMethod;
type CardForm = { name: string; number: string; expiry: string; cvc: string };
type CardErrors = Partial<Record<keyof CardForm, string>>;

const emptyCard: CardForm = { name: '', number: '', expiry: '', cvc: '' };

const money = (value: number | null | undefined) => value === null || value === undefined ? unavailableValue : `$${value.toFixed(2)}`;
const textValue = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? unavailableValue : String(value);

function cardLabel(card: PaymentCard) {
  return `${card.brand} ending in ${card.last4}`;
}

export default function BillingScreen() {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const { session } = useAuth();
  const customerId = session?.customerId ?? '';
  const [billing, setBilling] = useState<BillingViewData>(() => emptyBillingData(customerId));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Invoice>(billingPlaceholderInvoice());
  const [mode, setMode] = useState<Mode>(null);
  const [paymentChoice, setPaymentChoice] = useState('new');
  const [cardForm, setCardForm] = useState<CardForm>(emptyCard);
  const [cardErrors, setCardErrors] = useState<CardErrors>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [pendingDeleteCard, setPendingDeleteCard] = useState<PaymentCard | null>(null);
  const invoices = billing.invoices;
  const currentInvoice = invoices[0] ?? billingPlaceholderInvoice();
  const customer = billing.customer;
  const savedCards = billing.savedPaymentMethods;
  const defaultCard = savedCards.find((card) => card.isDefault) ?? savedCards[0];
  const defaultPaymentLabel = defaultCard ? cardLabel(defaultCard) : 'No saved card';
  const hasInvoice = invoices.length > 0;
  const displayInvoices = loading && !invoices.length ? [currentInvoice] : invoices;
  const statusFor = (invoice: Invoice) => invoice.status;
  const currentPaid = currentInvoice.status === 'Paid';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadBillingData(customerId, controller.signal).then((result) => {
      if (!active) return;
      if (result.state === 'unavailable') {
        setBilling(result.data);
        setLoadError(result.message);
        return;
      }
      setBilling(result.data);
      setCardForm((current) => ({ ...current, name: result.data.customer.name ?? '' }));
      setSelected(result.data.invoices[0] ?? billingPlaceholderInvoice());
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      setBilling(emptyBillingData(customerId));
      setLoadError(error instanceof Error ? error.message : 'Billing data could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [customerId]);

  const openPayment = (invoice: Invoice) => {
    setSelected(invoice);
    setPaymentChoice(defaultCard?.id ?? 'new');
    setCardForm({ ...emptyCard, name: customer.name ?? '' });
    setCardErrors({});
    setMode('payment');
  };

  const pay = async () => {
    try {
      const paymentMethodId = paymentChoice === 'new' ? await tokenizePaymentCard(cardForm) : paymentChoice;
      await payInvoice(customerId, selected.id, paymentMethodId);
      setMode(null);
      showToast(`Payment submitted for invoice ${selected.id}`);
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Payment could not be submitted.', 'warning');
    }
  };

  const documentFor = (invoice: Invoice) => invoiceHtml({
    id: invoice.id,
    period: invoice.period,
    due: invoice.due,
    amount: invoice.amount,
    amountDue: invoice.amountDue,
    issued: invoice.issued,
    days: invoice.days,
    status: statusFor(invoice),
    customerName: customer.name,
    customerId: customer.id,
    customerAddress: customer.address,
    currentPlan: customer.currentPlan,
    chargeLines: invoice.chargeLines,
    gst: invoice.gst,
    previousBalance: invoice.previousBalance,
    paymentsAndCredits: invoice.paymentsAndCredits,
    latePaymentFee: invoice.latePaymentFee,
  });

  const downloadInvoice = async (invoice: Invoice = selected) => {
    if (!hasInvoice || invoice.id === unavailableValue) {
      showToast('Invoice data is not available yet.', 'info');
      return;
    }
    if (documentBusy) return;
    setDocumentBusy(true);
    void Haptics.selectionAsync();
    try {
      if (Platform.OS === 'web') {
        window.print();
        showToast('Choose “Save as PDF” in the print dialog', 'info');
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: documentFor(invoice) });
      if (!(await Sharing.isAvailableAsync())) {
        showToast('PDF created, but sharing is unavailable on this device.', 'warning');
        return;
      }
      await Sharing.shareAsync(uri, { dialogTitle: `Invoice ${invoice.id}`, mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      showToast(`Invoice ${invoice.id} PDF prepared`);
    } catch {
      showToast('The invoice PDF could not be prepared. Please try again.', 'warning');
    } finally {
      setDocumentBusy(false);
    }
  };

  const openPaymentMethod = () => {
    setMode('card');
  };

  const closePaymentMethod = () => {
    Keyboard.dismiss();
    setCardErrors({});
    setMode(null);
  };

  const openAddCard = () => {
    setCardForm({ ...emptyCard, name: customer.name ?? '' });
    setCardErrors({});
    setMakeDefault(false);
    setMode('add-card');
  };

  const updateCardForm = (field: keyof CardForm, value: string) => {
    setCardForm((current) => ({ ...current, [field]: value }));
    setCardErrors((current) => ({ ...current, [field]: undefined }));
  };

  const savePaymentMethod = async () => {
    try {
      const token = await tokenizePaymentCard(cardForm);
      await saveTokenizedPaymentMethod(customerId, token, makeDefault);
      setCardForm(emptyCard);
      setMode('card');
      showToast('Payment method saved');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Payment method could not be saved.', 'warning');
    }
  };

  const cancelRemoveCard = () => {
    setPendingDeleteCard(null);
    setMode('card');
  };

  const confirmRemoveCard = async () => {
    if (!pendingDeleteCard) return;
    try {
      await deletePaymentMethod(customerId, pendingDeleteCard.id);
      setBilling((current) => ({ ...current, savedPaymentMethods: current.savedPaymentMethods.filter((card) => card.id !== pendingDeleteCard.id) }));
      setPendingDeleteCard(null);
      setMode('card');
      showToast('Payment method removed');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Payment method could not be removed.', 'warning');
    }
  };

  return (
    <Screen>
      {loadError ? <Text style={[styles.historySubtitle, { color: palette.red }]}>{loadError}</Text> : null}
      <PageHeader action={<IconButton icon="download-outline" label="Download current invoice" onPress={() => void downloadInvoice(currentInvoice)} />} title="Billing" subtitle="Pay invoices, track payment status and manage your saved payment method." />

      <Card style={styles.balance}>
        <View style={styles.balanceTop}><View style={styles.balanceIcon}><Ionicons color={palette.violet} name="wallet-outline" size={24} /></View><View style={styles.balanceCopy}><Text style={[styles.label, { color: colors.textMuted }]}>Current balance</Text><Text style={[styles.amount, { color: colors.text }]}>{currentPaid ? money(0) : money(currentInvoice.amountDue ?? currentInvoice.amount)}</Text><Text style={[styles.due, { color: currentPaid ? palette.green : palette.red }]}>{currentPaid ? 'Payment received' : currentInvoice.due ? `Due ${currentInvoice.due}` : unavailableValue}</Text></View></View>
        <View style={styles.balanceActions}><View style={styles.balanceAction}><PrimaryButton disabled={!hasInvoice} icon="eye-outline" label="View" onPress={() => { setSelected(currentInvoice); setMode('preview'); }} variant="secondary" /></View><View style={styles.balanceAction}><PrimaryButton disabled={!hasInvoice || currentPaid} label={currentPaid ? 'Paid' : 'Pay'} onPress={() => openPayment(currentInvoice)} /></View></View>
      </Card>

      <Card style={styles.paymentMethod}>
        <View style={styles.cardGlyph}><Ionicons color="#FFFFFF" name="card" size={22} /></View><View style={styles.paymentCopy}><Text style={[styles.label, { color: colors.textMuted }]}>Default payment method</Text><Text style={[styles.paymentTitle, { color: colors.text }]}>{defaultPaymentLabel}</Text><Text style={[styles.paymentName, { color: colors.textMuted }]}>{defaultCard?.cardholder ?? 'Add a card to pay'}</Text></View><Pressable accessibilityRole="button" onPress={openPaymentMethod}><Text style={styles.manage}>Manage</Text></Pressable>
      </Card>

      <SectionTitle>Invoice history</SectionTitle>
      <Text style={[styles.historySubtitle, { color: colors.textMuted }]}>Your latest account documents.</Text>
      <Card style={styles.invoiceList}>
        {!loading && !invoices.length ? <Text style={[styles.historySubtitle, { color: colors.textMuted }]}>No invoices are available.</Text> : null}
        {displayInvoices.map((invoice, index) => {
          const status = statusFor(invoice);
          return (
            <View key={invoice.id} style={[styles.invoice, index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 }]}>
              <View style={[styles.invoiceIcon, { backgroundColor: colors.input }]}><Ionicons color={palette.violet} name="document-text-outline" size={20} /></View>
              <View style={styles.invoiceCopy}><Text style={[styles.invoiceTitle, { color: colors.text }]}>Invoice {invoice.id}</Text><Text style={[styles.invoiceMeta, { color: colors.textMuted }]}>{textValue(invoice.period)} · {money(invoice.amount)}</Text><Text style={[styles.status, { color: status === 'Paid' ? palette.green : palette.red }]}>{status}</Text></View>
              <View style={styles.invoiceActions}><Pressable accessibilityLabel={`View invoice ${invoice.id}`} disabled={!hasInvoice} hitSlop={8} onPress={() => { setSelected(invoice); setMode('preview'); }} style={[styles.rowAction, { backgroundColor: colors.input }]}><Ionicons color={colors.textMuted} name="eye-outline" size={19} /></Pressable><Pressable accessibilityLabel={`Download invoice ${invoice.id} as PDF`} disabled={!hasInvoice} hitSlop={8} onPress={() => void downloadInvoice(invoice)} style={[styles.rowAction, { backgroundColor: colors.input }]}><Ionicons color={palette.violet} name="download-outline" size={19} /></Pressable>{status === 'Due' ? <Pressable accessibilityLabel={`Pay invoice ${invoice.id}`} disabled={!hasInvoice} hitSlop={8} onPress={() => openPayment(invoice)} style={[styles.rowAction, styles.payAction]}><Ionicons color="#FFFFFF" name="card-outline" size={19} /></Pressable> : null}</View>
            </View>
          );
        })}
      </Card>

      <ModalSheet footer={<View style={styles.previewFooter}><View style={styles.previewDownload}><PrimaryButton icon="download-outline" label="Download PDF" onPress={() => void downloadInvoice()} /></View></View>} onClose={() => setMode(null)} title={`Invoice ${selected.id}`} visible={mode === 'preview'}>
        <InvoicePreview colors={colors} customer={customer} invoice={selected} status={statusFor(selected)} />
      </ModalSheet>

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setMode(null)} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label={`Pay ${money(selected.amount)}`} onPress={() => void pay()} /></View></View>} keyboardAware onClose={() => setMode(null)} title={`Pay invoice ${selected.id}`} visible={mode === 'payment'}>
        <View style={styles.confirm}><View style={styles.confirmIcon}><Ionicons color={palette.violet} name="card-outline" size={30} /></View><Text style={[styles.confirmTitle, { color: colors.text }]}>Pay <Text style={styles.confirmAmount}>{money(selected.amount)}</Text></Text><Text style={[styles.confirmCopy, { color: colors.textMuted }]}>Choose how you want to pay invoice {selected.id}.</Text></View>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Payment method</Text>
        <View style={styles.paymentChoices}>
          {savedCards.map((card) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: paymentChoice === card.id }} key={card.id} onPress={() => setPaymentChoice(card.id)} style={[styles.paymentChoice, { backgroundColor: colors.input, borderColor: paymentChoice === card.id ? palette.violet : colors.border }]}><View style={[styles.radio, { borderColor: paymentChoice === card.id ? palette.violet : colors.border }]}>{paymentChoice === card.id ? <View style={styles.radioFill} /> : null}</View><View style={styles.paymentChoiceCopy}><View style={styles.paymentChoiceTitleRow}><Text style={[styles.paymentChoiceTitle, { color: colors.text }]}>{cardLabel(card)}</Text>{card.isDefault ? <Text style={styles.defaultBadge}>DEFAULT</Text> : null}</View><Text style={[styles.paymentChoiceMeta, { color: colors.textMuted }]}>{textValue(card.cardholder)} · Expires {textValue(card.expiry)}</Text></View><Ionicons color={colors.textMuted} name="lock-closed-outline" size={16} /></Pressable>)}
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: paymentChoice === 'new' }} onPress={() => { setPaymentChoice('new'); setCardErrors({}); }} style={[styles.paymentChoice, { backgroundColor: colors.input, borderColor: paymentChoice === 'new' ? palette.violet : colors.border }]}><View style={[styles.radio, { borderColor: paymentChoice === 'new' ? palette.violet : colors.border }]}>{paymentChoice === 'new' ? <View style={styles.radioFill} /> : null}</View><View style={styles.paymentChoiceCopy}><Text style={[styles.paymentChoiceTitle, { color: colors.text }]}>Use a new card</Text><Text style={[styles.paymentChoiceMeta, { color: colors.textMuted }]}>Enter card details for this payment</Text></View><Ionicons color={palette.violet} name="add-circle-outline" size={21} /></Pressable>
        </View>
        {paymentChoice === 'new' ? <CardFormFields colors={colors} errors={cardErrors} form={cardForm} onChange={updateCardForm} /> : null}
      </ModalSheet>

      <ModalSheet footer={<PrimaryButton label="Done" onPress={closePaymentMethod} />} onClose={closePaymentMethod} title="Manage payment methods" visible={mode === 'card'}>
        <Text style={[styles.manageIntro, { color: colors.textMuted }]}>Add multiple cards and choose the default used first at checkout.</Text>
        <View style={styles.savedCards}>{!savedCards.length ? <Text style={[styles.manageIntro, { color: colors.textMuted }]}>No saved payment methods are available.</Text> : null}{savedCards.map((card) => {
          const isDefault = card.isDefault;
          return <View key={card.id} style={[styles.savedCard, { backgroundColor: colors.input, borderColor: isDefault ? palette.violet : colors.border }]}><View style={styles.savedCardTop}><View style={styles.savedCardIcon}><Ionicons color={palette.violet} name="card-outline" size={21} /></View><View style={styles.savedCardCopy}><View style={styles.paymentChoiceTitleRow}><Text style={[styles.savedCardTitle, { color: colors.text }]}>{cardLabel(card)}</Text>{isDefault ? <Text style={styles.defaultBadge}>DEFAULT</Text> : null}</View><Text style={[styles.savedCardMeta, { color: colors.textMuted }]}>{textValue(card.cardholder)}</Text></View></View><View style={[styles.savedCardActions, { borderTopColor: colors.border }]}><Text style={[styles.cardActionHint, { color: colors.textMuted }]}>Payment service unavailable</Text></View></View>;
        })}</View>
        <View style={styles.addCardButton}><PrimaryButton icon="add-outline" label="Add another card" onPress={openAddCard} variant="secondary" /></View>
      </ModalSheet>

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={cancelRemoveCard} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Delete card" onPress={() => void confirmRemoveCard()} variant="danger" /></View></View>} onClose={cancelRemoveCard} title="Delete saved card" visible={mode === 'delete-card'}>
        <View style={styles.deleteConfirm}><View style={styles.deleteIcon}><Ionicons color={palette.red} name="trash-outline" size={29} /></View><Text style={[styles.deleteTitle, { color: colors.text }]}>Delete {pendingDeleteCard ? cardLabel(pendingDeleteCard) : 'this card'}?</Text><Text style={[styles.deleteCopy, { color: colors.textMuted }]}>This card will be removed from your saved payment methods. This action cannot be undone.</Text></View>
      </ModalSheet>

      <ModalSheet dismissOnBackdropPress={false} footer={<View style={styles.footerButtons}><View style={styles.footerButton}><PrimaryButton label="Cancel" onPress={() => setMode('card')} variant="secondary" /></View><View style={styles.footerButton}><PrimaryButton label="Save card" onPress={() => void savePaymentMethod()} /></View></View>} keyboardAware onClose={() => setMode('card')} title="Add a new card" visible={mode === 'add-card'}>
        <CardFormFields colors={colors} errors={cardErrors} form={cardForm} onChange={updateCardForm} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: makeDefault }} onPress={() => setMakeDefault((value) => !value)} style={styles.defaultChoice}><View style={[styles.checkbox, { borderColor: makeDefault ? palette.violet : colors.border, backgroundColor: makeDefault ? palette.violet : 'transparent' }]}>{makeDefault ? <Ionicons color="#FFFFFF" name="checkmark" size={17} /> : null}</View><View><Text style={[styles.defaultChoiceTitle, { color: colors.text }]}>Make this my default card</Text><Text style={[styles.defaultChoiceMeta, { color: colors.textMuted }]}>It will be selected first for future payments.</Text></View></Pressable>
        <Text style={[styles.localNotice, { color: colors.textMuted }]}>You can change your default card at any time.</Text>
      </ModalSheet>
    </Screen>
  );
}

function CardFormFields({ colors, form, errors, onChange }: { colors: ReturnType<typeof useAppTheme>['colors']; form: CardForm; errors: CardErrors; onChange: (field: keyof CardForm, value: string) => void }) {
  return <View style={styles.cardForm}><FormField autoCapitalize="words" error={errors.name} label="Cardholder name" onChangeText={(value) => onChange('name', value)} placeholder="Name on card" value={form.name} /><FormField error={errors.number} keyboardType="number-pad" label="Card number" onChangeText={(value) => onChange('number', value)} placeholder="1234 5678 9012 3456" value={form.number} /><View style={styles.cardFormRow}><View style={styles.cardFormHalf}><FormField error={errors.expiry} keyboardType="numbers-and-punctuation" label="Expiry" onChangeText={(value) => onChange('expiry', value)} placeholder="MM/YY" value={form.expiry} /></View><View style={styles.cardFormHalf}><FormField error={errors.cvc} keyboardType="number-pad" label="Security code" onChangeText={(value) => onChange('cvc', value)} placeholder="CVC" secure value={form.cvc} /></View></View><View style={[styles.secureNotice, { backgroundColor: colors.input }]}><Ionicons color={palette.green} name="shield-checkmark-outline" size={17} /><Text style={[styles.secureNoticeText, { color: colors.textMuted }]}>Visa and Mastercard accepted</Text></View></View>;
}

function ChargeRow({ amount, calculation, colors, label }: { amount: string; calculation: string; colors: ReturnType<typeof useAppTheme>['colors']; label: string }) {
  return <View style={[styles.chargeRow, { borderBottomColor: colors.border }]}><View style={styles.chargeCopy}><Text style={[styles.chargeLabel, { color: colors.text }]}>{label}</Text><Text style={[styles.chargeCalculation, { color: colors.textMuted }]}>{calculation}</Text></View><Text style={[styles.chargeAmount, { color: colors.text }]}>{amount}</Text></View>;
}

/* Legacy calculation-based preview retained only as a temporary source reference during the data migration.
function LegacyInvoicePreview({ colors, invoice, status }: { colors: ReturnType<typeof useAppTheme>['colors']; invoice: Invoice; status: string }) {
  const breakdown = breakdownFor(invoice);
  const paid = status === 'Paid';
  const details = [
    ['Invoice date', invoice.issued],
    ['Due date', invoice.due],
    ['Status', status],
    ['Customer name', customer.name],
    ['Customer ID', customer.id],
    ['Current Plan', plan.name],
    ['Meter read', 'Actual smart meter read'],
    ['Supply address', customer.address],
  ];
  return <View style={styles.invoicePreview}><View style={styles.previewMark}><Ionicons color={palette.violet} name="flash" size={30} /></View><Text style={[styles.previewAmount, { color: colors.text }]}>{paid ? '$0.00' : `$${invoice.amount.toFixed(2)}`}</Text><Text style={[styles.previewDueLabel, { color: colors.textMuted }]}>{paid ? 'Payment received' : `Due ${invoice.due}`}</Text><Text style={[styles.previewPeriod, { color: colors.textMuted }]}>{invoice.period} · {invoice.days} days</Text><View style={styles.previewDetails}>{details.map(([label, value]) => <View key={label} style={[styles.previewDetailField, label === 'Supply address' && styles.previewDetailWide]}><Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text><View style={[styles.previewValueBox, { backgroundColor: colors.input, borderColor: colors.border }]}><Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text></View></View>)}</View><View style={styles.previewBreakdown}><Text style={[styles.breakdownTitle, { color: colors.text }]}>Electricity charges</Text><Text style={[styles.breakdownCaption, { color: colors.textMuted }]}>Rates and amounts include GST.</Text><View style={[styles.chargeTable, { borderColor: colors.border }]}><ChargeRow amount={`$${breakdown.usageCharge.toFixed(2)}`} calculation={`${breakdown.usageKwh.toFixed(2)} kWh × $${usageRate.toFixed(5)} / kWh`} colors={colors} label="Electricity usage" /><ChargeRow amount={`$${breakdown.dailyCharge.toFixed(2)}`} calculation={`${invoice.days} days × $${dailyRate.toFixed(2)} / day`} colors={colors} label="Daily charge" /></View><View style={[styles.previewTotal, { backgroundColor: colors.input }]}><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>GST included</Text><Text style={[styles.totalValue, { color: colors.text }]}>${breakdown.gstIncluded.toFixed(2)}</Text></View><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.text }]}>Current charges</Text><Text style={[styles.totalValue, { color: colors.text }]}>${invoice.amount.toFixed(2)}</Text></View><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>Payments and credits</Text><Text style={[styles.totalValue, { color: colors.text }]}>{paid ? `-$${invoice.amount.toFixed(2)}` : '$0.00'}</Text></View><View style={[styles.previewTotalRow, styles.previewGrandTotal]}><Text style={styles.previewGrandText}>Total amount due</Text><Text style={styles.previewGrandText}>{paid ? '$0.00' : `$${invoice.amount.toFixed(2)}`}</Text></View></View></View></View>;
}
*/

function InvoicePreview({ colors, invoice, status, customer }: { colors: ReturnType<typeof useAppTheme>['colors']; invoice: Invoice; status: string; customer: BillingViewData['customer'] }) {
  const paid = status === 'Paid';
  const details = [
    ['Invoice date', textValue(invoice.issued)],
    ['Due date', textValue(invoice.due)],
    ['Status', status],
    ['Customer name', textValue(customer.name)],
    ['Customer ID', textValue(customer.id)],
    ['Current Plan', textValue(customer.currentPlan)],
    ['Meter read', unavailableValue],
    ['Supply address', textValue(customer.address)],
  ];
  const chargeLines = invoice.chargeLines.length ? invoice.chargeLines : [{ label: 'Charges unavailable', quantity: null, rate: null, amount: null }];
  return <View style={styles.invoicePreview}><View style={styles.previewMark}><Ionicons color={palette.violet} name="flash" size={30} /></View><Text style={[styles.previewAmount, { color: colors.text }]}>{paid ? money(0) : money(invoice.amountDue ?? invoice.amount)}</Text><Text style={[styles.previewDueLabel, { color: colors.textMuted }]}>{paid ? 'Payment received' : invoice.due ? `Due ${invoice.due}` : unavailableValue}</Text><Text style={[styles.previewPeriod, { color: colors.textMuted }]}>{textValue(invoice.period)}{invoice.days === null ? '' : ` · ${invoice.days} days`}</Text><View style={styles.previewDetails}>{details.map(([label, value]) => <View key={label} style={[styles.previewDetailField, label === 'Supply address' && styles.previewDetailWide]}><Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text><View style={[styles.previewValueBox, { backgroundColor: colors.input, borderColor: colors.border }]}><Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text></View></View>)}</View><View style={styles.previewBreakdown}><Text style={[styles.breakdownTitle, { color: colors.text }]}>Electricity charges</Text><Text style={[styles.breakdownCaption, { color: colors.textMuted }]}>Rates and amounts include GST where provided.</Text><View style={[styles.chargeTable, { borderColor: colors.border }]}>{chargeLines.map((line, index) => <ChargeRow key={`${line.label}-${index}`} amount={money(line.amount)} calculation={`${textValue(line.quantity)} · ${textValue(line.rate)}`} colors={colors} label={line.label} />)}</View><View style={[styles.previewTotal, { backgroundColor: colors.input }]}><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>GST included</Text><Text style={[styles.totalValue, { color: colors.text }]}>{money(invoice.gst)}</Text></View><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.text }]}>Current charges</Text><Text style={[styles.totalValue, { color: colors.text }]}>{money(invoice.amount)}</Text></View><View style={styles.previewTotalRow}><Text style={[styles.totalLabel, { color: colors.textMuted }]}>Payments and credits</Text><Text style={[styles.totalValue, { color: colors.text }]}>{money(invoice.paymentsAndCredits)}</Text></View><View style={[styles.previewTotalRow, styles.previewGrandTotal]}><Text style={styles.previewGrandText}>Total amount due</Text><Text style={styles.previewGrandText}>{paid ? money(0) : money(invoice.amountDue ?? invoice.amount)}</Text></View></View></View></View>;
}

const styles = StyleSheet.create({
  balance: { gap: 18 }, balanceTop: { flexDirection: 'row', alignItems: 'center', gap: 14 }, balanceIcon: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#F0EDFF' }, balanceCopy: { flex: 1 }, balanceActions: { flexDirection: 'row', gap: 10 }, balanceAction: { flex: 1 }, label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }, amount: { marginTop: 2, fontSize: 30, fontWeight: '900' }, due: { marginTop: 3, fontSize: 12, fontWeight: '800' },
  paymentMethod: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 15 }, cardGlyph: { width: 46, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.violet }, paymentCopy: { flex: 1 }, paymentTitle: { marginTop: 2, fontSize: 14, fontWeight: '900' }, paymentName: { marginTop: 2, fontSize: 11 }, manage: { color: palette.violet, fontSize: 12, fontWeight: '900' },
  invoiceDocument: { padding: 0, overflow: 'hidden' }, documentHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }, planMark: { width: 52, height: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, planCopy: { flex: 1 }, planName: { fontSize: 18, fontWeight: '900' }, planSummary: { marginTop: 3, fontSize: 10, lineHeight: 14, fontWeight: '700' }, statusBadge: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 }, statusBadgeText: { fontSize: 9, fontWeight: '900' }, documentBody: { padding: 17 }, documentDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, documentDetailField: { width: '48.5%' }, documentValueBox: { minHeight: 45, justifyContent: 'center', marginTop: 5, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 }, documentDetailWide: { width: '100%' }, documentLabel: { paddingHorizontal: 2, fontSize: 8.5, lineHeight: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.35 }, documentValue: { fontSize: 10.5, lineHeight: 15, fontWeight: '800' }, invoiceNote: { marginTop: 16, borderLeftWidth: 3, borderLeftColor: '#FE6601', borderRadius: 10, backgroundColor: '#FFF2E6', padding: 12 }, invoiceNoteText: { color: '#74553C', fontSize: 11, lineHeight: 16 }, invoiceNoteStrong: { color: '#FE6601', fontWeight: '900' }, breakdownHeading: { marginTop: 19 }, breakdownTitle: { fontSize: 14, lineHeight: 19, fontWeight: '900' }, breakdownCaption: { marginTop: 3, fontSize: 9, lineHeight: 13 }, chargeTable: { marginTop: 10, overflow: 'hidden', borderWidth: 1, borderRadius: 15 }, chargeRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, chargeCopy: { flex: 1 }, chargeLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800' }, chargeCalculation: { marginTop: 3, fontSize: 9, lineHeight: 13 }, chargeAmount: { fontSize: 12, fontWeight: '900' }, totals: { marginTop: 12, overflow: 'hidden', borderWidth: 1, borderRadius: 17, padding: 12 }, totalRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 3, paddingVertical: 8 }, totalLabel: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: '700' }, totalValue: { fontSize: 11, fontWeight: '900' }, grandTotal: { marginTop: 8, borderTopWidth: 0, borderRadius: 12, backgroundColor: palette.violet, paddingHorizontal: 11 }, terms: { marginTop: 18, borderTopWidth: 1, paddingTop: 15 }, termsTitle: { fontSize: 12, fontWeight: '900' }, termsCopy: { marginTop: 4, fontSize: 10, lineHeight: 15 },
  historySubtitle: { marginTop: -8, marginBottom: 10, fontSize: 11 }, invoiceList: { paddingVertical: 2 }, invoice: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13 }, invoiceIcon: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, invoiceCopy: { flex: 1, minWidth: 0 }, invoiceTitle: { fontSize: 12, fontWeight: '900' }, invoiceMeta: { marginTop: 3, fontSize: 9, lineHeight: 13 }, status: { marginTop: 4, fontSize: 9, fontWeight: '900' }, invoiceActions: { flexDirection: 'row', gap: 5 }, rowAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, payAction: { backgroundColor: palette.violet },
  invoicePreview: { alignItems: 'center' }, previewMark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#F0EDFF' }, previewAmount: { marginTop: 14, fontSize: 34, fontWeight: '900' }, previewDueLabel: { marginTop: 2, fontSize: 11, fontWeight: '800' }, previewPeriod: { marginTop: 4, marginBottom: 28, fontSize: 12 }, previewDetails: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, previewDetailField: { width: '48.5%' }, previewValueBox: { minHeight: 46, justifyContent: 'center', marginTop: 5, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 }, previewDetailWide: { width: '100%' }, detailLabel: { paddingHorizontal: 2, fontSize: 8.5, lineHeight: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.35 }, detailValue: { fontSize: 10.5, lineHeight: 15, fontWeight: '800' }, previewBreakdown: { width: '100%', marginTop: 20 }, previewTotal: { marginTop: 12, overflow: 'hidden', borderRadius: 15, padding: 11 }, previewTotalRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4 }, previewGrandTotal: { marginTop: 6, borderRadius: 11, backgroundColor: palette.violet, paddingHorizontal: 11 }, previewGrandText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  footerButtons: { flex: 1, flexDirection: 'row', gap: 10 }, footerButton: { flex: 1 }, previewFooter: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }, previewDownload: { width: 176 }, confirm: { alignItems: 'center', paddingTop: 4, paddingBottom: 8 }, confirmIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#F0EDFF' }, confirmTitle: { marginTop: 13, fontSize: 18, lineHeight: 24, fontWeight: '700', textAlign: 'center' }, confirmAmount: { fontWeight: '900' }, confirmCopy: { marginTop: 5, fontSize: 12, lineHeight: 18, textAlign: 'center' }, deleteConfirm: { alignItems: 'center', paddingVertical: 8 }, deleteIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFEDF0' }, deleteTitle: { marginTop: 14, fontSize: 18, lineHeight: 24, fontWeight: '900', textAlign: 'center' }, deleteCopy: { maxWidth: 310, marginTop: 7, fontSize: 12, lineHeight: 18, textAlign: 'center' }, localNotice: { marginTop: 16, fontSize: 9, lineHeight: 14, textAlign: 'center' },
  fieldLabel: { marginTop: 12, marginBottom: 8, fontSize: 14, fontWeight: '900' }, paymentChoices: { gap: 9 }, paymentChoice: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 16, padding: 12 }, radio: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 11 }, radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.violet }, paymentChoiceCopy: { flex: 1 }, paymentChoiceTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, paymentChoiceTitle: { fontSize: 13, fontWeight: '900' }, paymentChoiceMeta: { marginTop: 4, fontSize: 10, lineHeight: 14 }, defaultBadge: { color: '#FFFFFF', backgroundColor: palette.green, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, fontSize: 7, fontWeight: '900', letterSpacing: 0.4 },
  manageIntro: { marginBottom: 13, fontSize: 12, lineHeight: 18 }, savedCards: { gap: 10 }, savedCard: { overflow: 'hidden', borderWidth: 1.5, borderRadius: 17 }, savedCardTop: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }, savedCardIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#F0EDFF' }, savedCardCopy: { flex: 1 }, savedCardTitle: { fontSize: 13, fontWeight: '900' }, savedCardMeta: { marginTop: 4, fontSize: 10 }, savedCardActions: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingHorizontal: 13 }, cardActionText: { color: palette.violet, fontSize: 11, fontWeight: '900' }, cardActionHint: { fontSize: 10, fontWeight: '700' }, addCardButton: { marginTop: 14 },
  cardForm: { gap: 14 }, cardFormRow: { flexDirection: 'row', gap: 10 }, cardFormHalf: { flex: 1 }, secureNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 11 }, secureNoticeText: { flex: 1, fontSize: 9, lineHeight: 13 }, defaultChoice: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 17 }, checkbox: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 8 }, defaultChoiceTitle: { fontSize: 12, fontWeight: '900' }, defaultChoiceMeta: { marginTop: 2, fontSize: 9 },
});
