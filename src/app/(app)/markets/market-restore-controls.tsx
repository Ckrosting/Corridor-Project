'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/** Server components can't hold an inline onChange, so this toggle lives in its own client file. */
export function ShowArchivedMarketsToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-600">
      <input
        type="checkbox" defaultChecked={checked}
        onChange={(e) => {
          const url = new URL(window.location.href);
          if (e.target.checked) url.searchParams.set('includeArchived', 'true');
          else url.searchParams.delete('includeArchived');
          router.push(url.pathname + url.search);
        }}
      />
      Show deleted
    </label>
  );
}

export function MarketRestoreButton({ marketId, version }: { marketId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets/${marketId}/restore?version=${version}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? 'Could not restore this market.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore this market.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => void restore()} disabled={busy}>
        {busy ? <Spinner /> : <Undo2 size={12} />} Restore
      </button>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </>
  );
}
