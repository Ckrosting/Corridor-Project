'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Undo2 } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/** Server components can't hold an inline onChange, so this toggle lives in its own client file. */
export function ShowArchivedContactsToggle({ checked }: { checked: boolean }) {
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
      Show archived
    </label>
  );
}

export function ContactRestoreButton({ contactId, version }: { contactId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/restore?version=${version}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? 'Could not restore this contact.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore this contact.');
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

export function ContactArchiveButton({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? 'Could not archive this contact.');
      router.push('/contacts');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive this contact.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
        onClick={() => setConfirming(true)}
        title="Archive this contact everywhere"
      >
        <Trash2 size={13} /> Archive
      </button>
    );
  }

  return (
    <div className="rounded border border-red-200 bg-red-50 p-3">
      <p className="text-xs text-red-800">
        Archive <span className="font-medium">{name}</span>? They disappear from the contacts list,
        search and exports everywhere. Their links to properties and their name on past calls stay
        exactly as they are — tick &ldquo;Show archived&rdquo; on the Contacts page to restore them.
      </p>
      {error && <div className="banner-error mt-2">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-danger btn-sm" onClick={() => void archive()} disabled={busy}>
          {busy ? <Spinner /> : <Trash2 size={13} />} Confirm archive
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => { setConfirming(false); setError(null); }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
