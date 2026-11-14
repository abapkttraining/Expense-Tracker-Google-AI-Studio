import { ArrowRight, BarChart3, MessageSquareText, ShieldCheck, Users } from 'lucide-react';

interface AuthGateProps {
  onSignIn: () => Promise<void>;
  signingIn: boolean;
  error: string | null;
}

export function AuthGate({ onSignIn, signingIn, error }: AuthGateProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-16 px-6 lg:px-10 border-b border-slate-200 bg-white flex items-center justify-between">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          KhataLedger
        </span>
        <button
          type="button"
          onClick={onSignIn}
          disabled={signingIn}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 text-white hover:bg-teal-800 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
        >
          {signingIn ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 lg:px-10 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-8">
          <div className="space-y-4">
            <p className="text-xs font-medium tracking-wide text-teal-700">
              Shared Household, Trip &amp; Personal Ledgers
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12] [text-wrap:balance]">
              Track every rupee across projects, UPI apps, and collaborators.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl">
              Organize isolated expense workspaces for Home Expenses, Goa Trips, or Personal budgets.
              Invite members by Gmail, analyze PhonePe and GPay spending trends, and log expenses
              in plain English.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-slate-200">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Users className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Shared Projects</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Invite collaborators by email with automatic linking when they sign in.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BarChart3 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Live Analytics</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Daily, weekly, monthly, and yearly breakdowns by tag and UPI method.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MessageSquareText className="w-4 h-4 text-teal-700 shrink-0" />
                <span>AI Expense Entry</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Type &ldquo;650 PhonePe dinner with friends&rdquo; and confirm in one click.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Sign in to your workspace
              </h2>
              <p className="text-sm text-slate-600">
                Use your Google account to sync shared ledgers and pending project invitations.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
              <p className="text-xs font-medium text-slate-500">Natural-language entry preview</p>
              <p className="text-sm text-slate-800 font-medium">
                &ldquo;1200 GPay electricity bill and internet&rdquo;
              </p>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>Google Pay (GPay) · Electricity · Internet</span>
                <span className="font-mono-tabular font-semibold text-slate-900">₹1,200</span>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
              >
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={onSignIn}
              disabled={signingIn}
              className="w-full py-3 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>{signingIn ? 'Connecting to Google...' : 'Continue with Google'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
              <span>Verified Google Identity &amp; isolated project permissions</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
