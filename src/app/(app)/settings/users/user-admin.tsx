'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, UserPlus } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/** Creates an account. Passwords are hashed with bcrypt and never stored in plain text. */
export function UserAdmin({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'member', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  void currentUserId;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ message: string }>;
      };
      if (!res.ok) {
        throw new Error(body.details?.[0]?.message ?? body.error ?? 'Could not create that account.');
      }

      setForm({ name: '', email: '', role: 'member', password: '' });
      setOpen(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that account.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>
          <UserPlus size={13} /> Add a user
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs font-medium text-green-700">
            <Check size={13} /> Account created
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="card">
      <div className="card-header"><h2 className="card-title">New user</h2></div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="u-name">Name</label>
          <input
            id="u-name" className="input" autoFocus
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="u-email">Email</label>
          <input
            id="u-email" type="email" className="input"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="u-role">Role</label>
          <select
            id="u-role" className="input"
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="member">Member — research, edit, log calls, manage opportunities</option>
            <option value="admin">Admin — also users, settings, imports, destructive actions</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="u-pass">Initial password</label>
          <input
            id="u-pass" type="password" className="input" autoComplete="new-password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <p className="field-hint">
            At least 12 characters. Share it securely; they can change it after signing in.
          </p>
        </div>
      </div>
      {error && <div className="px-4 pb-2"><div className="banner-error" role="alert">{error}</div></div>}
      <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
        <button
          type="button" className="btn-secondary" disabled={busy}
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner />} Create account
        </button>
      </div>
    </section>
  );
}
