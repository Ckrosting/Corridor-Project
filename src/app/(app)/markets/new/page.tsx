import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/guards';
import { NewMarketForm } from './new-market-form';

export const metadata = { title: 'New market' };
export const dynamic = 'force-dynamic';

export default async function NewMarketPage() {
  await requirePageUser();
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-200 bg-white px-6 py-3">
        <Link href="/markets" className="text-xs text-ink-500 hover:text-accent-700">Markets</Link>
        <span className="text-ink-300">/</span>
        <h1 className="text-base font-semibold tracking-tight text-ink-900">New market</h1>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-lg">
          <NewMarketForm />
        </div>
      </div>
    </>
  );
}
