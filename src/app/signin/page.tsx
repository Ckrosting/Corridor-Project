import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { SignInForm } from './signin-form';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const actor = await getActor();
  if (actor) redirect(params.next || '/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Hull Corridor</h1>
          <p className="mt-1 text-xs text-ink-500">
            Corridor research and acquisitions · Hull Property Group
          </p>
        </div>

        <div className="card p-5">
          <SignInForm
            next={params.next ?? '/'}
            initialError={params.error}
            devBypassEnabled={env.devAuthBypass}
            devEmail={env.devAuthEmail}
          />
        </div>

        {env.devAuthBypass && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-amber-700">
            Development sign-in is enabled on this machine only. It is removed
            entirely from production builds.
          </p>
        )}
      </div>
    </main>
  );
}
