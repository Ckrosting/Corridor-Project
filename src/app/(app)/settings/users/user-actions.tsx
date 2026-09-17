'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, KeyRound, RotateCcw, ShieldOff, ShieldCheck } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface Row {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  isActive: boolean;
  archived?: boolean;
}

type Panel = null | 'archive' | 'password';

/** Server components can't hold an inline onChange, so the "show archived" toggle lives here. */
export function ShowArchivedToggle({ checked }: { checked: boolean }) {
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

/**
 * Per-account admin controls. An admin cannot demote, disable or archive their
 * own account — the server refuses it too, this just keeps the footgun off the
 * screen.
 */
export function UserActions({ user, isSelf }: { user: Row; isSelf: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function send(path: string, method: 'PATCH' | 'DELETE' | 'POST', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ message: string }>;
      };
      if (!res.ok) {
        throw new Error(payload.details?.[0]?.message ?? payload.error ?? 'That change could not be saved.');
      }
      setPanel(null);
      setPassword('');
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function flash(message: string) {
    setDone(message);
    setTimeout(() => setDone(null), 3000);
  }

  if (user.archived) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button" className="btn-secondary btn-sm" disabled={busy}
          onClick={() => void send(`/api/users/${user.id}/restore`, 'POST')}
        >
          {busy ? <Spinner /> : <RotateCcw size={13} />} Restore
        </button>
        {error && <span className="text-[11px] text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className="input h-7 w-24 py-0 text-xs"
          aria-label={`Role for ${user.name}`}
          value={user.role}
          disabled={busy || isSelf}
          onChange={(e) => void send(`/api/users/${user.id}`, 'PATCH', { role: e.target.value })}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>

        {!isSelf && (
          <>
            <button
              type="button" className="btn-ghost btn-sm" disabled={busy}
              title={user.isActive ? 'Block sign-in for this account' : 'Allow sign-in again'}
              onClick={async () => {
                const okDone = await send(`/api/users/${user.id}`, 'PATCH', { isActive: !user.isActive });
                if (okDone) flash(user.isActive ? 'Disabled' : 'Re-enabled');
              }}
            >
              {user.isActive ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </button>

            <button
              type="button" className="btn-ghost btn-sm"
              onClick={() => { setPanel(panel === 'password' ? null : 'password'); setError(null); }}
            >
              <KeyRound size={13} /> Reset password
            </button>

            <button
              type="button" className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
              onClick={() => { setPanel(panel === 'archive' ? null : 'archive'); setError(null); }}
            >
              <Archive size={13} /> Archive
            </button>
          </>
        )}

        {isSelf && <span className="text-[11px] text-ink-400">You cannot change your own access.</span>}
        {done && <span className="text-[11px] font-medium text-green-700">{done}</span>}
      </div>

      {panel === 'password' && (
        <div className="rounded border border-ink-200 bg-ink-50 p-2">
          <label className="label" htmlFor={`pw-${user.id}`}>New password for {user.name}</label>
          <div className="flex gap-2">
            <input
              id={`pw-${user.id}`} type="password" className="input h-7 py-0 text-xs"
              autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button" className="btn-primary btn-sm" disabled={busy}
              onClick={async () => {
                const okDone = await send(`/api/users/${user.id}/password`, 'POST', { newPassword: password });
                if (okDone) flash('Password reset');
              }}
            >
              {busy && <Spinner />} Set
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setPanel(null); setPassword(''); }}>
              Cancel
            </button>
          </div>
          <p className="field-hint">At least 12 characters. Share it securely.</p>
        </div>
      )}

      {panel === 'archive' && (
        <div className="rounded border border-red-200 bg-red-50 p-2">
          <p className="text-xs text-red-800">
            Archive <span className="font-medium">{user.name}</span>? They lose access and drop off this
            list. Nothing is erased — their name stays on every call note and audit entry they authored,
            and an admin can restore the account.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button" className="btn-danger btn-sm" disabled={busy}
              onClick={() => void send(`/api/users/${user.id}`, 'DELETE')}
            >
              {busy ? <Spinner /> : <Archive size={13} />} Confirm archive
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPanel(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="banner-error" role="alert">{error}</div>}
    </div>
  );
}
