import { DISPLAY_CURRENCIES, getCurrencySymbol, type DisplayCurrency } from '../constants';
import { useCurrency } from '../hooks/useCurrency';

interface CurrencyToggleProps {
  className?: string;
}

export function CurrencyToggle({ className = '' }: CurrencyToggleProps) {
  const { currency, setCurrency, inrPerUnit } = useCurrency();

  const getTooltip = (code: DisplayCurrency) => {
    if (code === 'INR') return 'Display amounts in Indian Rupees (INR)';
    const unitRate = inrPerUnit[code];
    return `Display amounts in ${code} (1 ${code} = ₹${unitRate.toFixed(2)})`;
  };

  return (
    <div
      role="group"
      aria-label="Display currency"
      className={`inline-flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 ${className}`}
    >
      {DISPLAY_CURRENCIES.map((code) => {
        const active = currency === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setCurrency(code)}
            aria-pressed={active}
            title={getTooltip(code)}
            className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1 ${
              active
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <span className="font-mono-tabular">{getCurrencySymbol(code)}</span>
            <span className="hidden sm:inline">{code}</span>
          </button>
        );
      })}
    </div>
  );
}
