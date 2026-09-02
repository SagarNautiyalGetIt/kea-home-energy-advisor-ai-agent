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
  rates: Array<{ label: string; value: string; unit: string; window?: string }>
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
