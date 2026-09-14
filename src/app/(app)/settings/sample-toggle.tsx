'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/primitives';

/**
 * Controls whether demonstration records are visible.
 *
 * One setting drives every screen, so counts and lists can never disagree about
 * whether sample data is included.
 */
export function SampleDataToggle({
  initialValue, canEdit,
}: { initialValue: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'show_sample_data', value: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save that setting.');
      setValue(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that setting.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value}
          disabled={!canEdit || busy}
          onChange={(e) => void save(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-ink-900">Show demonstration records</span>
          <span className="block text-xs leading-relaxed text-ink-600">
            Sample records are prefixed &ldquo;SAMPLE&rdquo;, badged in every list, and stored with a
            flag that keeps them separate from real data. Turn this off once you have loaded your own
            markets; to remove them permanently, run <code className="rounded bg-ink-100 px-1">npm run db:seed</code>{' '}
            without the <code className="rounded bg-ink-100 px-1">--demo</code> flag after deleting them.
          </span>
        </span>
        {busy && <Spinner className="mt-0.5" />}
      </label>
      {!canEdit && <p className="field-hint">Only an administrator can change this.</p>}
      {error && <div className="banner-error mt-2" role="alert">{error}</div>}
    </div>
  );
}
