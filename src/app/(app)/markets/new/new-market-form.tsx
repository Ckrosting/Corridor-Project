'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Spinner } from '@/components/ui/primitives';

export function NewMarketForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), state: state || null, notes: notes || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; market?: { id: string } };
      if (!res.ok || !body.market) throw new Error(body.error ?? 'Could not create the market.');
      router.push(`/markets/${body.market.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the market.');
      setBusy(false);
    }
  }

  return (
    <form className="card p-5" onSubmit={submit}>
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="m-name">Market name <span className="text-red-600">*</span></label>
          <input
            id="m-name" className="input" required autoFocus
            placeholder="e.g. Augusta, GA"
            value={name} onChange={(e) => setName(e.target.value)}
          />
          <p className="field-hint">Usually the metro area around one of your malls.</p>
        </div>

        <div>
          <label className="label" htmlFor="m-state">State</label>
          <input
            id="m-state" className="input" maxLength={2} placeholder="GA"
            value={state} onChange={(e) => setState(e.target.value.toUpperCase())}
          />
        </div>

        <div>
          <label className="label" htmlFor="m-notes">Notes</label>
          <textarea id="m-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="banner-error" role="alert">{error}</div>}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Link href="/markets" className="btn-secondary">Cancel</Link>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          {busy && <Spinner />} Create market
        </button>
      </div>
    </form>
  );
}
