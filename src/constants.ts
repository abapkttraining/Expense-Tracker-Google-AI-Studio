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

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
