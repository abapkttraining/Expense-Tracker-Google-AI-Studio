export interface SeedTagDef {
  id: string;
  name: string;
  color: string;
  parentCategory: string;
}

export const DEFAULT_SYSTEM_TAGS: SeedTagDef[] = [
  { id: 'bills', name: 'Bills', color: '#0F766E', parentCategory: '' },
  { id: 'bills-electricity', name: 'Electricity', color: '#D97706', parentCategory: 'Bills' },
  { id: 'bills-phone-recharge', name: 'Phone Recharge', color: '#0284C7', parentCategory: 'Bills' },
  { id: 'bills-internet', name: 'Internet', color: '#2563EB', parentCategory: 'Bills' },
  { id: 'oil-fuel', name: 'Oil/Fuel', color: '#B45309', parentCategory: '' },
  { id: 'travel', name: 'Travel', color: '#0D9488', parentCategory: '' },
  { id: 'trips', name: 'Trips', color: '#0891B2', parentCategory: '' },
  { id: 'food', name: 'Food', color: '#EA580C', parentCategory: '' },
  { id: 'entertainment', name: 'Entertainment', color: '#9333EA', parentCategory: '' },
  { id: 'restaurants', name: 'Restaurants', color: '#DC2626', parentCategory: '' },
  { id: 'friends', name: 'Friends', color: '#4F46E5', parentCategory: '' },
  { id: 'family', name: 'Family', color: '#16A34A', parentCategory: '' },
  { id: 'personal', name: 'Personal', color: '#475569', parentCategory: '' },
  { id: 'skin-care', name: 'Skin Care', color: '#DB2777', parentCategory: '' },
  { id: 'body-care', name: 'Body Care', color: '#E11D48', parentCategory: '' },
  { id: 'hair-care', name: 'Hair Care', color: '#7C3AED', parentCategory: '' },
  { id: 'other', name: 'Other', color: '#64748B', parentCategory: '' },
];

export const TAG_COLOR_SWATCHES = [
  '#0F766E',
  '#0284C7',
  '#2563EB',
  '#4F46E5',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#D97706',
  '#16A34A',
  '#475569',
];

export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  PhonePe: '#5F259F',
  'Google Pay (GPay)': '#1A73E8',
  'BHIM UPI': '#EA580C',
  Paytm: '#00BAF2',
  'Debit Card': '#0F766E',
  'Credit Card': '#334155',
  Cash: '#16A34A',
};

export type DisplayCurrency = 'INR' | 'USD' | 'EUR';

export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = ['INR', 'USD', 'EUR'] as const;

export interface ExchangeRateSnapshot {
  base: 'INR';
  date: string;
  source: string;
  rates: Record<DisplayCurrency, number>;
  inrPerUnit: Record<DisplayCurrency, number>;
  updatedAt: string;
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getFallbackExchangeRates(dateStr: string = getTodayISO()): ExchangeRateSnapshot {
  let seed = 0;
  for (let i = 0; i < dateStr.length; i += 1) {
    seed = (seed * 31 + dateStr.charCodeAt(i)) % 1000003;
  }
  const usdOffset = ((seed % 121) - 60) * 0.01;
  const eurOffset = (((seed * 7) % 161) - 80) * 0.01;

  const inrPerUsd = Math.round((84.25 + usdOffset) * 100) / 100;
  const inrPerEur = Math.round((91.15 + eurOffset) * 100) / 100;

  return {
    base: 'INR',
    date: dateStr,
    source: 'Daily Fallback Rate',
    rates: {
      INR: 1,
      USD: Math.round((1 / inrPerUsd) * 1_000_000) / 1_000_000,
      EUR: Math.round((1 / inrPerEur) * 1_000_000) / 1_000_000,
    },
    inrPerUnit: {
      INR: 1,
      USD: inrPerUsd,
      EUR: inrPerEur,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getCurrencySymbol(currency: DisplayCurrency): string {
  if (currency === 'USD') return '$';
  if (currency === 'EUR') return '€';
  return '₹';
}

export function convertFromINR(
  amountInINR: number,
  currency: DisplayCurrency,
  rates: Record<DisplayCurrency, number>
): number {
  if (!Number.isFinite(amountInINR)) return 0;
  if (currency === 'INR') return amountInINR;
  const rate = rates[currency] ?? 1;
  return Math.round(amountInINR * rate * 100) / 100;
}

export function formatConvertedAmount(
  convertedAmount: number,
  currency: DisplayCurrency,
  options?: { compactAxis?: boolean }
): string {
  const safeVal = Number.isFinite(convertedAmount) ? convertedAmount : 0;
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: options?.compactAxis || safeVal % 1 === 0 ? 0 : 2,
    }).format(safeVal);
  }

  const showZeroDecimals = options?.compactAxis && safeVal % 1 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showZeroDecimals || safeVal === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safeVal);
}

export function formatINR(amount: number): string {
  return formatConvertedAmount(amount, 'INR');
}

export function formatCurrency(
  amountInINR: number,
  currency: DisplayCurrency = 'INR',
  rates?: Record<DisplayCurrency, number>
): string {
  if (currency === 'INR') {
    return formatConvertedAmount(amountInINR, 'INR');
  }
  const activeRates = rates ?? getFallbackExchangeRates().rates;
  const converted = convertFromINR(amountInINR, currency, activeRates);
  return formatConvertedAmount(converted, currency);
}
