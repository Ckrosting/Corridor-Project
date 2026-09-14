'use client';

import { useState } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/**
 * Promotion into the transaction pipeline.
 *
 * This dialog is the only way a property enters the pipeline. A reason is
 * mandatory — the point is that the pipeline reflects deliberate judgement, not
 * accumulated call activity — and it is stored with the date and the author.
 */
const SUGGESTED_REASONS = [
  'An off-market owner has expressed interest in selling.',
  'A broker or owner shared information that makes a deal attractive.',
  'Buyer and seller are getting close on price.',
  'The team sees a concrete acquisition opportunity here.',
];

export function PromoteDialog({
  propertyId, propertyName, defaultTargetPrice, onClose, onPromoted,
}: {
  propertyId: string;
  propertyName: string;
  defaultTargetPrice?: string | null;
  onClose(): void;
  onPromoted(): void;
}) {
  const [name, setName] = useState(propertyName);
  const [reason, setReason] = useState('');
  const [targetPrice, setTargetPrice] = useState(defaultTargetPrice ?? '');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDate, setNextStepDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonTooShort = reason.trim().length < 10;

  async function submit() {
    if (reasonTooShort) {
      setError('Please describe why this is a real opportunity (at least 10 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/opportunities/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          name: name.trim() || undefined,
          promotionReason: reason.trim(),
          targetPrice: targetPrice || null,
          nextStep: nextStep || null,
          nextStepDate: nextStepDate || null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not promote this property.');
      }
      onPromoted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote this property.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-6" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md">
        <div className="card-header">
          <h2 className="card-title flex items-center gap-1.5">
            <TrendingUp size={15} /> Promote to opportunity
          </h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="banner-info">
            <span>
              Promoting moves this property into the transaction pipeline. Routine
              calls and follow-ups never do this on their own — the reason you give
              here is recorded with today&rsquo;s date and your name.
            </span>
          </div>

          <div>
            <label className="label" htmlFor="opp-name">Opportunity name</label>
            <input id="opp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label" htmlFor="opp-reason">
              Why is this a real opportunity? <span className="text-red-600">*</span>
            </label>
            <textarea
              id="opp-reason" className="input" rows={3} autoFocus
              placeholder="e.g. Owner volunteered a price and wants to move before the spring lease renewal."
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SUGGESTED_REASONS.map((r) => (
                <button
                  key={r} type="button"
                  className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-50"
                  onClick={() => setReason(r)}
                >
                  {r.length > 42 ? `${r.slice(0, 40)}…` : r}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="opp-target">Target price</label>
              <input
                id="opp-target" className="input" inputMode="decimal" placeholder="Optional"
                value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="opp-date">Next step by</label>
              <input
                id="opp-date" type="date" className="input"
                value={nextStepDate} onChange={(e) => setNextStepDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="opp-next">Next step</label>
            <input
              id="opp-next" className="input" placeholder="Optional"
              value={nextStep} onChange={(e) => setNextStep(e.target.value)}
            />
          </div>

          {error && <div className="banner-error" role="alert">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy || reasonTooShort}>
            {busy && <Spinner />} Promote
          </button>
        </div>
      </div>
    </div>
  );
}
