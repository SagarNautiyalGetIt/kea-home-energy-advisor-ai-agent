import type { ImageSourcePropType } from 'react-native';

export const usage = {
  daily: {
    labels: ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'],
    values: [0.11, 0.1, 0.09, 0.06, 0.06, 0.08, 0.1, 0.13, 0.17, 0.18, 0.2, 0.22, 0.18, 0.16, 0.16, 0.2, 0.23, 0.27, 0.32, 0.37, 0.41, 0.18, 0.13, 0.09],
    previous: [0.1, 0.09, 0.08, 0.07, 0.06, 0.07, 0.11, 0.12, 0.15, 0.17, 0.18, 0.2, 0.17, 0.15, 0.17, 0.18, 0.21, 0.25, 0.3, 0.34, 0.38, 0.2, 0.14, 0.1],
  },
  weekly: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    values: [4.2, 4.8, 4.1, 5, 5.4, 2.6, 2.4],
    previous: [4.5, 4.2, 4.7, 4.6, 5.1, 3.1, 2.9],
  },
  monthly: {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    values: [24, 32, 34, 26],
    previous: [27, 29, 31, 30],
  },
} as const;

export const dashboardToday = {
  labels: Array.from({ length: 24 }, (_, hour) => `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`),
  values: [0.32, 0.27, 0.21, 0.19, 0.18, 0.21, 0.32, 0.48, 0.58, 0.64, 0.69, 0.74, 0.8, 0.85, 0.9, 0.96, 1.06, 1.17, 1.33, 1.49, 1.59, 1.43, 1.17, 1.02],
} as const;

export type NewsItem = {
  id: string;
  title: string;
  date: string;
  summary: string;
  body: string;
  image: ImageSourcePropType;
};

export const news: NewsItem[] = [
  {
    id: 'care',
    title: 'New consumer protection standards',
    date: '24 Aug 2026',
    summary: 'Clearer information and easier access to support.',
    body: 'Kea Energy is updating customer communications and support processes to reflect the new consumer care standards.',
    image: require('../../assets/kea/news/consumer-protection-policy.jpg'),
  },
  {
    id: 'off-peak',
    title: 'Off-peak discount coming soon',
    date: '21 Aug 2026',
    summary: 'Move flexible use away from busy periods.',
    body: 'Eligible customers will be able to benefit from lower off-peak pricing. Full eligibility and timing will be shared before launch.',
    image: require('../../assets/kea/news/off-peak-discount.jpg'),
  },
  {
    id: 'winter',
    title: 'Winter energy support available',
    date: '18 Aug 2026',
    summary: 'Practical guidance and account support when needed.',
    body: 'Our winter support programme offers energy-saving guidance and account assistance during colder months.',
    image: require('../../assets/kea/news/winter-energy-support.jpg'),
  },
  {
    id: 'maintenance',
    title: 'Planned network maintenance',
    date: '15 Aug 2026',
    summary: 'Selected areas will receive advance notice.',
    body: 'Customers affected by planned maintenance will receive timing and restoration information in advance.',
    image: require('../../assets/kea/news/network-maintenance.jpg'),
  },
];

export const invoices = [
  { id: '367274627', issued: '20 Aug 2026', period: '05 Aug 2026 – 19 Aug 2026', days: 15, due: '01 Sep 2026', amount: 184.5, status: 'Due' as const },
  { id: '361892440', issued: '05 Aug 2026', period: '05 Jul 2026 – 04 Aug 2026', days: 31, due: '18 Aug 2026', amount: 148.2, status: 'Paid' as const },
  { id: '355703118', issued: '05 Jul 2026', period: '05 Jun 2026 – 04 Jul 2026', days: 30, due: '18 Jul 2026', amount: 132.76, status: 'Paid' as const },
];

export type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  icon: keyof typeof import('@expo/vector-icons/Ionicons').default.glyphMap;
  unread: boolean;
};

export const notifications: readonly NotificationItem[] = [
  { id: 'high-bill', title: 'High bill warning', detail: 'Projected bill is 29% above your usual range.', time: 'Today, 9:30 AM', icon: 'warning-outline', unread: true },
  { id: 'payment', title: 'Payment reminder', detail: 'Your current invoice is due on 1 Sep 2026.', time: 'Yesterday', icon: 'card-outline', unread: true },
  { id: 'usage', title: 'Usage update', detail: 'New smart-meter readings are available.', time: '31 Aug 2026', icon: 'stats-chart-outline', unread: false },
];

export const faqs = [
  {
    question: 'What is Sparky AI?',
    answer: 'Sparky is Kea Energy’s digital AI assistant that helps you understand your electricity usage, bills and plan options. It turns complex energy information into clear explanations, provides early warnings about possible high bills and connects you with human support when needed.',
  },
  {
    question: 'What can Sparky help me with?',
    answer: 'Sparky can explain changes in your electricity bill, warn you when your projected bill is higher than expected, compare Kea plans using your usage pattern and answer general questions about your energy account. It can also connect you with the Kea support team when a question requires human assistance.',
  },
  {
    question: 'How does Sparky work?',
    answer: 'Sparky understands your question and requests information from approved accounts, usage and pricing services. These services perform important calculations, while Sparky explains the results in straightforward language. Sparky is not allowed to create its own bill amounts, projections or savings figures.',
  },
  {
    question: 'What information does Sparky use?',
    answer: 'Depending on your question, Sparky may use your electricity usage, billing history, current plan, alert preferences and information you choose to upload. It only uses the information needed to answer your request. The current prototype uses synthetic demonstration data rather than real customer accounts.',
  },
  {
    question: 'How does the Bill Explainer work?',
    answer: 'The Bill Explainer reads the information in your electricity bill and compares it with available usage and pricing data. It identifies the charges, days and time periods that contributed most to the total, then explains them in plain language. It will not claim that a particular appliance caused an increase unless supporting data is available.',
  },
  {
    question: 'What can I upload to the Bill Explainer?',
    answer: 'You can upload an electricity bill as a PDF, JPG or PNG file, including a clear photo or screenshot. Make sure the full bill is readable and avoid uploading unrelated documents or information that is not needed for the explanation.',
  },
  {
    question: 'What is a bill-shock warning?',
    answer: 'A bill-shock warning is an early notification that your projected bill has crossed your selected dollar threshold or is significantly higher than your normal pattern. It gives you an opportunity to review what changed and take action before the billing period ends.',
  },
  {
    question: 'How often will Kea send warnings?',
    answer: 'Kea sends an initial warning when your projected bill crosses the threshold you selected. It will not repeatedly send the same alert, but it may send another warning if the projection increases significantly. You can change your threshold, notification channel or opt out of warnings at any time.',
  },
  {
    question: 'Is my projected bill the same as my final bill?',
    answer: 'No. A projected bill is an estimate based on your usage so far, expected usage for the rest of the billing period and your current pricing information. Your final bill may differ if your usage changes, additional meter information becomes available or adjustments are applied.',
  },
  {
    question: 'How does Kea compare plans?',
    answer: 'Kea applies each available Kea plan to your usage pattern and calculates the estimated cost, including usage rates, daily charges, free-power periods, monthly credits, commitment length and possible exit fees. It may recommend staying on your current plan if changing would not provide a meaningful benefit.',
    note: 'Kea does not compare every electricity provider in New Zealand, only the big four energy providers.',
  },
  {
    question: 'How does Sparky make sure its answers are accurate?',
    answer: 'Bill amounts, projections and plan comparisons are calculated by verified services using defined pricing rules. Sparky explains those results and uses approved information for general questions. Important figures can be traced back to the data and calculation that produced them.',
  },
  {
    question: 'Can Sparky make mistakes?',
    answer: 'Yes. Like any AI system, Sparky may misunderstand a question or provide an incomplete response. It is designed to acknowledge uncertainty instead of guessing, but you should contact the Kea support team if an answer appears incorrect or you want an official review.',
  },
  {
    question: 'How does Kea protect my information?',
    answer: 'Kea uses authentication, encryption and access controls to protect customer information. The system is designed to use only the data needed for each request and prevent customers from accessing another person’s account. Sensitive account details are not disclosed until the customer’s identity has been verified.',
  },
  {
    question: 'Are my conversations with Sparky stored?',
    answer: 'Conversations may be stored securely for a limited period to provide the service, maintain an audit record, investigate problems and improve safety and quality. Access is restricted to authorised systems and staff. Kea does not use your private account conversations to train a publicly available AI model.',
  },
  {
    question: 'Can I speak to a real person?',
    answer: 'Yes. You can request human assistance at any time. Sparky will also offer a handoff when it cannot answer safely, when you dispute important information or when your situation requires additional support. Where possible, relevant conversation context will be transferred so you do not have to repeat everything.',
  },
];
