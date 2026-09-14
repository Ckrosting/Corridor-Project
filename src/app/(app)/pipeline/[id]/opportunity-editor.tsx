'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, RotateCcw, TriangleAlert } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface Opportunity {
  id: string;
  version: number;
  name: string;
  stageId: string;
  state: string;
  targetPrice: string | null;
  offerPrice: string | null;
  contractPrice: string | null;
  expectedCloseDate: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  notes: string | null;
}

/**
 * Edits an opportunity, moves it between stages, and removes/reopens it.
 *
 * Removal is never a delete: the record and its whole stage history stay, and a
 * dead or on-hold opportunity can be put back on the board at any time.
 */
export function OpportunityEditor({
  opportunity, stages,
}: {
  opportunity: Opportunity;
  stages: Array<{ id: string; label: string; color: string; isTerminal: boolean }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: opportunity.name,
    stageId: opportunity.stageId,
    stageChangeNote: '',
    targetPrice: opportunity.targetPrice ?? '',
    offerPrice: opportunity.offerPrice ?? '',
    contractPrice: opportunity.contractPrice ?? '',
    expectedCloseDate: opportunity.expectedCloseDate ?? '',
    nextStep: opportunity.nextStep ?? '',
    nextStepDate: opportunity.nextStepDate ?? '',
    notes: opportunity.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [removing, setRemoving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const stageChanged = form.stageId !== opportunity.stageId;
  const blank = (v: string) => (v.trim() === '' ? null : v.trim());

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, version: opportunity.version }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        setConflict(true);
        setError(payload.error ?? 'Someone else changed this opportunity while you were editing.');
        return false;
      }
      if (!res.ok) throw new Error(payload.error ?? 'Could not save.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Deal details</h2>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
            <Check size={12} /> Saved
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        {conflict && (
          <div className="banner-error">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>
              <strong>Someone else saved first.</strong> Nothing of theirs was overwritten.{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => router.refresh()}>
                Reload
              </button>{' '}
              and reapply your changes.
            </span>
          </div>
        )}
        {error && !conflict && <div className="banner-error" role="alert">{error}</div>}

        <div>
          <label className="label" htmlFor="o-name">Opportunity name</label>
          <input id="o-name" className="input" value={form.name} onChange={set('name')} />
        </div>

        <div>
          <label className="label" htmlFor="o-stage">Stage</label>
          <select id="o-stage" className="input" value={form.stageId} onChange={set('stageId')}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.label}{s.isTerminal ? ' (closes the deal)' : ''}</option>
            ))}
          </select>
        </div>

        {stageChanged && (
          <div>
            <label className="label" htmlFor="o-note">Note about this stage change</label>
            <input
              id="o-note" className="input" placeholder="Optional, kept in the stage history"
              value={form.stageChangeNote} onChange={set('stageChangeNote')}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label" htmlFor="o-target">Target price</label>
            <input id="o-target" className="input" inputMode="decimal" value={form.targetPrice} onChange={set('targetPrice')} />
          </div>
          <div>
            <label className="label" htmlFor="o-offer">Offer price</label>
            <input id="o-offer" className="input" inputMode="decimal" value={form.offerPrice} onChange={set('offerPrice')} />
          </div>
          <div>
            <label className="label" htmlFor="o-contract">Contract price</label>
            <input id="o-contract" className="input" inputMode="decimal" value={form.contractPrice} onChange={set('contractPrice')} />
          </div>
          <div>
            <label className="label" htmlFor="o-close">Expected close</label>
            <input id="o-close" type="date" className="input" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="o-next">Next step</label>
            <input id="o-next" className="input" value={form.nextStep} onChange={set('nextStep')} />
          </div>
          <div>
            <label className="label" htmlFor="o-nextdate">By</label>
            <input id="o-nextdate" type="date" className="input" value={form.nextStepDate} onChange={set('nextStepDate')} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="o-notes">Deal notes</label>
          <textarea id="o-notes" className="input" rows={4} value={form.notes} onChange={set('notes')} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-3">
        {opportunity.state === 'active' ? (
          removing ? (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="Why is this leaving the active pipeline?"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
              />
              <button
                type="button" className="btn-danger btn-sm" disabled={busy}
                onClick={async () => { if (await send({ state: 'removed', reason: removeReason || null })) setRemoving(false); }}
              >
                {busy && <Spinner />} Confirm removal
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setRemoving(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setRemoving(true)} disabled={busy}>
              Remove from pipeline
            </button>
          )
        ) : (
          <button
            type="button" className="btn-secondary btn-sm" disabled={busy}
            onClick={() => void send({ state: 'active' })}
          >
            <RotateCcw size={13} /> Reopen into the pipeline
          </button>
        )}

        {!removing && (
          <button
            type="button" className="btn-primary" disabled={busy}
            onClick={() => void send({
              name: form.name,
              stageId: form.stageId,
              stageChangeNote: blank(form.stageChangeNote),
              targetPrice: blank(form.targetPrice),
              offerPrice: blank(form.offerPrice),
              contractPrice: blank(form.contractPrice),
              expectedCloseDate: blank(form.expectedCloseDate),
              nextStep: blank(form.nextStep),
              nextStepDate: blank(form.nextStepDate),
              notes: blank(form.notes),
            })}
          >
            {busy && <Spinner />} Save changes
          </button>
        )}
      </div>

      {opportunity.state === 'removed' && (
        <div className="border-t border-ink-200 px-4 py-2">
          <p className="text-[11px] text-ink-500">
            This opportunity is off the active board but nothing has been deleted. Its
            properties, notes and full stage history are intact.
          </p>
        </div>
      )}
    </section>
  );
}
