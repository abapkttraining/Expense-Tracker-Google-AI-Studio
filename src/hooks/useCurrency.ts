import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  convertFromINR,
  formatCurrency,
  getFallbackExchangeRates,
  getTodayISO,
  type DisplayCurrency,
  type ExchangeRateSnapshot,
} from '../constants';

const CURRENCY_STORAGE_KEY = 'khata-currency';
const RATES_STORAGE_KEY = 'khata-exchange-rates';

interface CurrencyStoreState {
  currency: DisplayCurrency;
  snapshot: ExchangeRateSnapshot;
  loadingRates: boolean;
  rateError: string | null;
  isFallbackRate: boolean;
}

function getInitialCurrency(): DisplayCurrency {
  if (typeof window === 'undefined') return 'INR';
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (stored === 'INR' || stored === 'USD' || stored === 'EUR') {
      return stored;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'INR';
}

function getInitialSnapshot(): { snapshot: ExchangeRateSnapshot; isCachedToday: boolean } {
  const today = getTodayISO();
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(RATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExchangeRateSnapshot;
        if (
          parsed &&
          parsed.date === today &&
          parsed.rates &&
          typeof parsed.rates.USD === 'number' &&
          typeof parsed.rates.EUR === 'number' &&
          parsed.inrPerUnit &&
          typeof parsed.inrPerUnit.USD === 'number' &&
          typeof parsed.inrPerUnit.EUR === 'number'
        ) {
          return { snapshot: parsed, isCachedToday: true };
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }
  return { snapshot: getFallbackExchangeRates(today), isCachedToday: false };
}

const initialRates = getInitialSnapshot();

let storeState: CurrencyStoreState = {
  currency: getInitialCurrency(),
  snapshot: initialRates.snapshot,
  loadingRates: false,
  rateError: null,
  isFallbackRate: !initialRates.isCachedToday,
};

let hasAttemptedInitialFetch = false;
let activeFetchPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updateStore(partial: Partial<CurrencyStoreState>) {
  storeState = { ...storeState, ...partial };
  emitChange();
}

function setCurrencyStore(next: DisplayCurrency) {
  if (storeState.currency === next) return;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  }
  updateStore({ currency: next });
}

async function fetchDailyRates(force = false): Promise<void> {
  const today = getTodayISO();
  if (!force && hasAttemptedInitialFetch && storeState.snapshot.date === today && !storeState.isFallbackRate) {
    return;
  }
  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  hasAttemptedInitialFetch = true;
  updateStore({ loadingRates: true, rateError: null });

  activeFetchPromise = (async () => {
    try {
      const response = await fetch(`/api/exchange-rates?date=${encodeURIComponent(today)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Exchange rate API returned ${response.status}`);
      }
      const data = (await response.json()) as ExchangeRateSnapshot;
      if (
        !data ||
        !data.rates ||
        typeof data.rates.USD !== 'number' ||
        typeof data.rates.EUR !== 'number'
      ) {
        throw new Error('Invalid exchange rate response.');
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(data));
        } catch {
          // Ignore storage quota errors
        }
      }

      updateStore({
        snapshot: data,
        loadingRates: false,
        rateError: null,
        isFallbackRate: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch daily exchange rates.';
      updateStore({
        snapshot: getFallbackExchangeRates(today),
        loadingRates: false,
        rateError: msg,
        isFallbackRate: true,
      });
    } finally {
      activeFetchPromise = null;
    }
  })();

  return activeFetchPromise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === CURRENCY_STORAGE_KEY &&
      (event.newValue === 'INR' || event.newValue === 'USD' || event.newValue === 'EUR')
    ) {
      if (storeState.currency !== event.newValue) {
        updateStore({ currency: event.newValue });
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

function getSnapshot(): CurrencyStoreState {
  return storeState;
}

const SERVER_SNAPSHOT: CurrencyStoreState = {
  currency: 'INR',
  snapshot: getFallbackExchangeRates('2026-01-01'),
  loadingRates: false,
  rateError: null,
  isFallbackRate: true,
};

function getServerSnapshot(): CurrencyStoreState {
  return SERVER_SNAPSHOT;
}

export function useCurrency() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!hasAttemptedInitialFetch) {
      void fetchDailyRates(false);
    }
  }, []);

  const setCurrency = useCallback((next: DisplayCurrency) => {
    setCurrencyStore(next);
  }, []);

  const refreshRates = useCallback(async () => {
    await fetchDailyRates(true);
  }, []);

  const convertAmount = useCallback(
    (amountInINR: number) => convertFromINR(amountInINR, state.currency, state.snapshot.rates),
    [state.currency, state.snapshot.rates]
  );

  const formatAmount = useCallback(
    (amountInINR: number) => formatCurrency(amountInINR, state.currency, state.snapshot.rates),
    [state.currency, state.snapshot.rates]
  );

  return {
    currency: state.currency,
    rates: state.snapshot.rates,
    inrPerUnit: state.snapshot.inrPerUnit,
    rateSnapshot: state.snapshot,
    loadingRates: state.loadingRates,
    rateError: state.rateError,
    isFallbackRate: state.isFallbackRate,
    setCurrency,
    refreshRates,
    convertAmount,
    formatAmount,
  };
}
