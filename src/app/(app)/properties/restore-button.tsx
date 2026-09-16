'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/**
 * Brings an archived property back into the working set.
 *
 * Archiving is reachable from the property panel, so the way back has to be
 * reachable too - otherwise "deleted" means a developer with database access,
 * whatever the confirmation copy promises.
 */
export function RestoreButton({ propertyId, version }: { propertyId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/restore?version=${version}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? 'Could not restore this property.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore this property.');
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
