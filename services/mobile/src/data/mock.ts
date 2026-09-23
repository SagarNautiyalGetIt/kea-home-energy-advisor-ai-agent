export const dailyUsage = [4.2, 4.8, 4.1, 5, 5.4, 2.6, 2.4]
export const hourlyUsage = [
  0.11, 0.1, 0.09, 0.06, 0.06, 0.08,
  0.1, 0.13, 0.17, 0.18, 0.2, 0.22,
  0.18, 0.16, 0.16, 0.2, 0.23, 0.27,
  0.32, 0.37, 0.41, 0.18, 0.13, 0.09,
]
export const monthlyUsage = [24, 32, 34, 26]

export const profile = {
  customerId: '110733ap',
  name: 'Adela Parkson',
  address: 'Albany, Auckland',
  phone: '02141236978',
  email: 'Adela98@gmail.com',
}

/* A Kea plan is built from two independent choices — a pricing style and a
   commitment term — so the three options in each field make nine plans.
   Rates and credits follow the plan research document. */

export type PricingStyleId = 'anytime' | 'time-of-use' | 'free-weekends'

export type PricingStyle = {
  id: PricingStyleId
  name: string
  eyebrow: string
  summary: string
  dailyCharge: string
  rate: string
  daily: string
  rates: { label: string; value: string; unit: string; window?: string }[]
  highlights: string[]
  bestFor: string
  flag?: string
}

export const pricingStyles: PricingStyle[] = [
  {
    id: 'anytime',
    name: 'Anytime Rate',
    eyebrow: 'One rate, all day',
    summary: 'The same usage rate at every time of day, so your bill follows only how much you use.',
    dailyCharge: '$1.45',
    rate: '$0.325',
    daily: '$1.45',
    rates: [{ label: 'Anytime rate', value: '$0.325', unit: '/kWh' }],
    highlights: ['Same rate day and night', 'Nothing to plan your day around', 'The easiest bill to predict'],
    bestFor: 'Customers wanting simplicity',
  },
  {
    id: 'time-of-use',
    name: 'Time of Use',
    eyebrow: 'Cheaper away from peak',
    summary: 'Separate peak, off-peak and night rates, so moving usage out of the evening peak pays off.',
    dailyCharge: '$1.50',
    rate: '$0.390',
    daily: '$1.50',
    rates: [
      { label: 'Peak', value: '$0.390', unit: '/kWh', window: '7–11 AM · 5–9 PM' },
      { label: 'Off-peak', value: '$0.270', unit: '/kWh', window: '11 AM–5 PM · 9–11 PM' },
      { label: 'Night', value: '$0.180', unit: '/kWh', window: '11 PM–7 AM' },
    ],
    highlights: ['The night rate is under half the peak rate', 'Ideal for delayed appliances and overnight EV charging', 'Matches the usage bands on your Usage page'],
    bestFor: 'Customers able to shift usage',
    flag: 'RECOMMENDED FOR YOU',
  },
  {
    id: 'free-weekends',
    name: 'Free Weekends',
    eyebrow: '16 free hours weekly',
    summary: 'Power is free from 9am to 5pm every Saturday and Sunday, with a higher rate outside that window.',
    dailyCharge: '$1.55',
    rate: '$0.365',
    daily: '$1.55',
    rates: [
      { label: 'Anytime rate', value: '$0.365', unit: '/kWh' },
      { label: 'Free period', value: 'Sat & Sun', unit: '', window: '9 AM–5 PM' },
    ],
    highlights: ['Eight free hours each weekend day', 'Run laundry and big appliances for nothing', 'A higher rate applies outside the free window'],
    bestFor: 'Households using more electricity on weekends',
  },
]

export type CommitmentTermId = 'flexible' | '6-months' | '12-months'

export type CommitmentTerm = {
  id: CommitmentTermId
  name: string
  priceTreatment: string
  monthlyCredit: string
  creditNote: string
  totalCredit: string
  earlyExitFee: string
  flag?: string
}

export const commitmentTerms: CommitmentTerm[] = [
  {
    id: 'flexible',
    name: 'Flexible',
    priceTreatment: 'Rates may change with notice',
    monthlyCredit: 'No credit',
    creditNote: 'No fixed term — leave whenever you like',
    totalCredit: '$0',
    earlyExitFee: 'No exit fee',
  },
  {
    id: '6-months',
    name: '6 months',
    priceTreatment: 'Rates locked for 6 months',
    monthlyCredit: '$10',
    creditNote: '$10 credit every month for 6 months',
    totalCredit: '$60',
    earlyExitFee: 'Up to $50',
  },
  {
    id: '12-months',
    name: '12 months',
    priceTreatment: 'Rates locked for 12 months',
    monthlyCredit: '$25',
    creditNote: '$25 credit every month for 12 months',
    totalCredit: '$300',
    earlyExitFee: 'Up to $100',
    flag: 'BEST VALUE',
  },
]

/* What the customer is on today, so the page can mark it and show a switch. */
export const currentPlan: { pricingStyle: PricingStyleId; term: CommitmentTermId } = {
  pricingStyle: 'anytime',
  term: 'flexible',
}

export const planInclusions = [
  'AI usage tracking and bill forecasts',
  'Personalised saving tips',
  'Digital bills and account support',
  'Smart meter required — check your address',
]

export type DemoHomeScenario = {
  id: 'day' | 'evening' | 'night';
  label: string;
  detail: string;
  solarKw: number;
  evKw: number;
  evCharging: boolean;
  evSoc: number;
  homeKw: number;
  powerwallKw: number;
  powerwallDischarging: boolean;
  powerwallSoc: number;
  gridKw: number;
};

export const demoHomeScenarios: DemoHomeScenario[] = [
  {
    id: 'day',
    label: 'Solar mode',
    detail: 'More solar generation and lower grid draw',
    solarKw: 8.4,
    evKw: 2.1,
    evCharging: true,
    evSoc: 78,
    homeKw: 3.2,
    powerwallKw: 1.8,
    powerwallDischarging: false,
    powerwallSoc: 74,
    gridKw: 0.6,
  },
  {
    id: 'evening',
    label: 'Evening peak',
    detail: 'Higher household demand after work and dinner',
    solarKw: 2.4,
    evKw: 4.6,
    evCharging: true,
    evSoc: 61,
    homeKw: 5.7,
    powerwallKw: 2.8,
    powerwallDischarging: true,
    powerwallSoc: 68,
    gridKw: 1.9,
  },
  {
    id: 'night',
    label: 'Night standby',
    detail: 'Powerwall covers overnight demand with efficient storage',
    solarKw: 0,
    evKw: 2.3,
    evCharging: false,
    evSoc: 52,
    homeKw: 2.8,
    powerwallKw: 3.1,
    powerwallDischarging: true,
    powerwallSoc: 56,
    gridKw: 0.8,
  },
];

export const dashboardToday = {
  labels: ['6am', '9am', '12pm', '3pm', '6pm', '9pm'],
  values: [2.1, 4.8, 6.7, 8.4, 7.2, 3.5],
};

export const notifications = [
  { id: 'bill-shock', title: 'Bill shock risk', detail: 'Your forecast is tracking above last month.', unread: true },
  { id: 'solar-win', title: 'Solar win', detail: 'Your roof is producing 18% more than forecast.', unread: false },
  { id: 'plan-tip', title: 'Plan tip', detail: 'A Time of Use plan could save you $14 this cycle.', unread: true },
];

export const usage = {
  daily: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    values: [5.2, 6.1, 5.8, 7.3, 6.4, 4.7, 3.8],
    previous: [4.9, 5.5, 5.4, 6.9, 5.9, 4.2, 3.5],
  },
  weekly: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    values: [31.4, 28.8, 33.1, 29.7, 35.6, 26.5, 22.2],
    previous: [29.5, 30.1, 31.3, 27.8, 34.2, 25.7, 21.8],
  },
  monthly: {
    labels: ['W1', 'W2', 'W3', 'W4'],
    values: [84, 78, 92, 88],
    previous: [80, 75, 86, 90],
  },
};

export const faqs = [
  {
    question: 'How do I understand my energy bill?',
    answer: 'Sparky breaks your bill into usage, network costs, and plan rate changes so you can see what changed.',
    note: 'Use the bill explanation screen for a detailed walk-through.',
  },
  {
    question: 'Can I compare plans?',
    answer: 'Yes. The Plans screen compares pricing styles and commitment terms to show which option fits your household.',
  },
  {
    question: 'What is a bill shock warning?',
    answer: 'It highlights when your projected cycle cost is materially higher than normal and suggests likely drivers.',
  },
];

export const demoPlansData = {
  pricingStyles,
  commitmentTerms,
  currentPlan,
};

export const demoProfileData = {
  customerId: profile.customerId,
  name: profile.name,
  address: profile.address,
  phone: profile.phone,
  email: profile.email,
};

export const demoBillingData = {
  customer: {
    name: profile.name,
    id: profile.customerId,
    address: profile.address,
    currentPlan: 'Anytime Rate',
  },
  invoices: [
    {
      id: 'INV-1024',
      issued: '2026-08-12',
      period: 'Aug 2026',
      days: 31,
      due: '2026-09-06',
      amount: 148.2,
      amountDue: 148.2,
      status: 'Due' as const,
      chargeLines: [
        { label: 'Energy use', quantity: '431 kWh', rate: '$0.325 / kWh', amount: 140.08 },
        { label: 'Daily charge', quantity: '31 days', rate: '$1.45 / day', amount: 44.95 },
      ],
      gst: 18.42,
      previousBalance: 0,
      paymentsAndCredits: 0,
      latePaymentFee: 0,
    },
  ],
  savedPaymentMethods: [
    { id: 'pm-1', brand: 'Visa', last4: '4242', cardholder: profile.name, expiry: '09/28', isDefault: true },
  ],
};
