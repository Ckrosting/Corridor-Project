'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/**
 * The monthly AI spend ceiling.
 *
 * Deliberately has no default the team did not choose: it is enforced before a
 * scan starts and re-checked between corridors, and a budget of $0 disables
 * scans entirely. Nothing recurring ever runs on its own — every scan is an
 * explicit action.
 */
export function BudgetForm({
  initialBudget, spend, rates,
}: {
  initialBudget: number;
  spend: number;
  rates: { inputPerMTok: number; outputPerMTok: number; webSearchPerThousand: number };
}) {
  const router = useRouter();
  const [budget, setBudget] = useState(String(initialBudget));
  const [rateForm, setRateForm] = useState({
    inputPerMTok: String(rates.inputPerMTok),
    outputPerMTok: String(rates.outputPerMTok),
    webSearchPerThousand: String(rates.webSearchPerThousand),
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetNum = Number(budget);
  const usedPct = budgetNum > 0 ? Math.min(100, (spend / budgetNum) * 100) : 100;

  async function save(key: string, value: unknown) {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not save.');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!Number.isFinite(budgetNum) || budgetNum < 0) {
        throw new Error('Enter a budget of zero or more.');
      }
      await save('ai_monthly_budget_usd', budgetNum);
      await save('ai_cost_rates', {
        inputPerMTok: Number(rateForm.inputPerMTok),
        outputPerMTok: Number(rateForm.outputPerMTok),
        webSearchPerThousand: Number(rateForm.webSearchPerThousand),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-medium text-ink-700">
            About <span className="tnum">${spend.toFixed(2)}</span> recorded this month
          </span>
          <span className="text-[11px] text-ink-500 tnum">
            {budgetNum > 0 ? `${usedPct.toFixed(0)}% of $${budgetNum.toFixed(2)}` : 'scans disabled'}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-200">
          <div
            className={`h-full transition-all ${usedPct > 85 ? 'bg-red-600' : 'bg-accent-600'}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label" htmlFor="budget">Monthly budget (USD)</label>
          <input
            id="budget" className="input" inputMode="decimal"
            value={budget} onChange={(e) => setBudget(e.target.value)}
          />
          <p className="field-hint">0 disables scans</p>
        </div>
        <div>
          <label className="label" htmlFor="r-in">Input $/M tokens</label>
          <input
            id="r-in" className="input" inputMode="decimal"
            value={rateForm.inputPerMTok}
            onChange={(e) => setRateForm({ ...rateForm, inputPerMTok: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="r-out">Output $/M tokens</label>
          <input
            id="r-out" className="input" inputMode="decimal"
            value={rateForm.outputPerMTok}
            onChange={(e) => setRateForm({ ...rateForm, outputPerMTok: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="r-search">$/1000 searches</label>
          <input
            id="r-search" className="input" inputMode="decimal"
            value={rateForm.webSearchPerThousand}
            onChange={(e) => setRateForm({ ...rateForm, webSearchPerThousand: e.target.value })}
          />
        </div>
      </div>

      <div className="banner-info">
        <span>
          The budget is checked before a scan starts <strong>and again between corridors</strong>,
          so a long multi-market scan stops when the ceiling is reached and keeps whatever it had
          already found. No scan ever runs on a schedule — every one is started by a person.
        </span>
      </div>

      {error && <div className="banner-error" role="alert">{error}</div>}

      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner />} Save
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs font-medium text-green-700">
            <Check size={13} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
