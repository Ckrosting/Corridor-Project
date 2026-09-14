'use client';

import { useState } from 'react';
import { Check, PhoneCall } from 'lucide-react';
import { CALL_OUTCOME_LABELS, todayIso } from '@/lib/format';
import { Spinner } from '@/components/ui/primitives';

export interface CallContactOption {
  id: string;
  name: string;
  relationship: string;
  phone: string | null;
}

export interface OutreachStatusOption {
  id: string;
  label: string;
  color: string;
}

/** Outcomes that usually mean a real conversation happened. */
const CONVERSATION_OUTCOMES = new Set([
  'spoke_with_broker', 'spoke_with_owner', 'interested_in_selling',
  'may_sell_later', 'requested_information', 'not_interested',
]);

const QUICK_OUTCOMES = ['no_answer', 'voicemail_left', 'spoke_with_owner', 'spoke_with_broker'] as const;

/**
 * Fast call logging.
 *
 * Designed for the common case first: pick an outcome, click Log. Everything
 * else — who was spoken to, motivation, pricing, timing, follow-up, status —
 * is optional and collapsed until needed, but reachable without leaving the panel.
 */
export function CallLogger({
  propertyId, contacts, statuses, currentStatusId, onLogged,
}: {
  propertyId: string;
  contacts: CallContactOption[];
  statuses: OutreachStatusOption[];
  currentStatusId: string | null;
  onLogged(): void;
}) {
  const [outcome, setOutcome] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [sellerMotivation, setSellerMotivation] = useState('');
  const [pricingExpectation, setPricingExpectation] = useState('');
  const [timingNotes, setTimingNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [statusId, setStatusId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const hadConversation = CONVERSATION_OUTCOMES.has(outcome);

  async function submit() {
    if (!outcome) {
      setError('Choose an outcome first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          type: 'call',
          outcome,
          contactId: contactId || null,
          notes: notes || null,
          sellerMotivation: sellerMotivation || null,
          pricingExpectation: pricingExpectation || null,
          timingNotes: timingNotes || null,
          followUpDate: followUpDate || null,
          setNextFollowUpDate: followUpDate || undefined,
          setOutreachStatusId: statusId || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not save the call.');
      }

      // Reset for the next call; the timeline above refreshes from the server.
      setOutcome(''); setContactId(''); setNotes('');
      setSellerMotivation(''); setPricingExpectation(''); setTimingNotes('');
      setFollowUpDate(''); setStatusId(''); setExpanded(false);
      setSavedAt(Date.now());
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the call.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
          <PhoneCall size={13} /> Log a call
        </span>
        {savedAt && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
            <Check size={12} /> Saved
          </span>
        )}
      </div>

      {/* One click for the four commonest outcomes. */}
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        {QUICK_OUTCOMES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setOutcome(key); setSavedAt(null); setError(null); }}
            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
              outcome === key
                ? 'border-accent-600 bg-accent-600 text-white'
                : 'border-ink-300 bg-white text-ink-700 hover:bg-ink-100'
            }`}
          >
            {CALL_OUTCOME_LABELS[key]}
          </button>
        ))}
      </div>

      <select
        className="input mb-2 text-xs"
        value={outcome}
        onChange={(e) => { setOutcome(e.target.value); setSavedAt(null); }}
        aria-label="Call outcome"
      >
        <option value="">Other outcome…</option>
        {Object.entries(CALL_OUTCOME_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {contacts.length > 0 && (
        <select
          className="input mb-2 text-xs"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          aria-label="Who did you speak with"
        >
          <option value="">Who did you speak with? (optional)</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.relationship}{c.phone ? ` · ${c.phone}` : ''}
            </option>
          ))}
        </select>
      )}

      <textarea
        className="input mb-2 text-xs"
        rows={hadConversation ? 3 : 2}
        placeholder="Notes…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {!expanded && (
        <button
          type="button"
          className="mb-2 text-[11px] font-medium text-accent-600 hover:text-accent-700"
          onClick={() => setExpanded(true)}
        >
          + Motivation, pricing, timing, follow-up, status
        </button>
      )}

      {expanded && (
        <div className="mb-2 space-y-2 border-t border-ink-200 pt-2">
          <div>
            <label className="label" htmlFor="motivation">Seller motivation</label>
            <textarea
              id="motivation" className="input text-xs" rows={2}
              placeholder="Why might they sell? Any urgency?"
              value={sellerMotivation} onChange={(e) => setSellerMotivation(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="pricing">Pricing expectation</label>
            <textarea
              id="pricing" className="input text-xs" rows={2}
              placeholder="What number did they mention, and how firm was it?"
              value={pricingExpectation} onChange={(e) => setPricingExpectation(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="timing">Timing</label>
            <input
              id="timing" className="input text-xs"
              placeholder="e.g. after the anchor lease renews in the spring"
              value={timingNotes} onChange={(e) => setTimingNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="status">Move outreach status to</label>
            <select
              id="status" className="input text-xs"
              value={statusId} onChange={(e) => setStatusId(e.target.value)}
            >
              <option value="">Leave unchanged</option>
              {statuses.filter((s) => s.id !== currentStatusId).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <p className="field-hint">Changing status adds a timeline entry. It never removes call history.</p>
          </div>
        </div>
      )}

      <div className="mb-2">
        <label className="label" htmlFor="followup">Follow up on</label>
        <div className="flex gap-1.5">
          <input
            id="followup" type="date" className="input text-xs"
            value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)}
          />
          {[
            { label: '+3d', days: 3 },
            { label: '+1w', days: 7 },
            { label: '+1m', days: 30 },
          ].map((preset) => (
            <button
              key={preset.label} type="button" className="btn-secondary btn-sm"
              onClick={() => setFollowUpDate(todayIso(preset.days))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="banner-error mb-2" role="alert">{error}</div>}

      <button type="button" className="btn-primary w-full btn-sm" onClick={() => void submit()} disabled={busy}>
        {busy ? <Spinner /> : <PhoneCall size={13} />}
        Log call
      </button>
    </div>
  );
}
