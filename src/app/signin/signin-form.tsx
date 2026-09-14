'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/primitives';

export function SignInForm({
  next, initialError, devBypassEnabled, devEmail,
}: {
  next: string;
  initialError?: string;
  devBypassEnabled: boolean;
  devEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'credentials' | 'dev' | null>(null);
  const [error, setError] = useState<string | null>(
    initialError === 'admin-required' ? 'That section requires an administrator account.' : null,
  );

  async function submit(provider: 'credentials' | 'dev-bypass', body?: Record<string, string>) {
    setBusy(provider === 'credentials' ? 'credentials' : 'dev');
    setError(null);
    try {
      const res = await signIn(provider, { ...body, redirect: false });
      if (res?.error) {
        // Deliberately generic: do not confirm whether an email is registered.
        setError('Those sign-in details were not recognised.');
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check that the app is running and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit('credentials', { email, password });
        }}
      >
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email" type="email" autoComplete="username" required autoFocus
            className="input" value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password" type="password" autoComplete="current-password" required
            className="input" value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="banner-error" role="alert">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={busy !== null}>
          {busy === 'credentials' && <Spinner />}
          Sign in
        </button>
      </form>

      {devBypassEnabled && (
        <>
          <div className="flex items-center gap-3 text-[11px] text-ink-400">
            <div className="h-px flex-1 bg-ink-200" />
            development only
            <div className="h-px flex-1 bg-ink-200" />
          </div>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={busy !== null}
            onClick={() => void submit('dev-bypass')}
          >
            {busy === 'dev' && <Spinner />}
            Continue as {devEmail}
          </button>
        </>
      )}
    </div>
  );
}
