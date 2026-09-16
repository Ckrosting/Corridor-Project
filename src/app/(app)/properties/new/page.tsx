import Link from 'next/link';
import { asc, isNull } from 'drizzle-orm';
import { ArrowLeft } from 'lucide-react';
import { db } from '@/db';
import { markets, outreachStatuses } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { getPropertyTypes } from '@/lib/services/settings';
import { NewPropertyForm } from './new-property-form';

export const metadata = { title: 'New property' };
export const dynamic = 'force-dynamic';

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const marketId = one('marketId');

  const [marketList, statusList, propertyTypes] = await Promise.all([
    db.select({ id: markets.id, name: markets.name }).from(markets)
      .where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
    db.select({ id: outreachStatuses.id, label: outreachStatuses.label, color: outreachStatuses.color })
      .from(outreachStatuses).where(isNull(outreachStatuses.archivedAt))
      .orderBy(asc(outreachStatuses.sortOrder)),
    getPropertyTypes(),
  ]);

  const market = marketId ? marketList.find((m) => m.id === marketId) ?? null : null;

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link
            href={market ? `/markets/${market.id}` : '/properties'}
            className="flex items-center gap-1 hover:text-accent-700"
          >
            <ArrowLeft size={12} /> {market ? market.name : 'Properties'}
          </Link>
        </div>
        <h1 className="text-base font-semibold tracking-tight text-ink-900">New property</h1>
        <p className="text-xs text-ink-500">
          Only a market is required. Everything else can be filled in as you learn it — a blank
          field means unknown, never zero.
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <NewPropertyForm
            markets={marketList}
            statuses={statusList}
            propertyTypes={propertyTypes}
            defaultMarketId={market?.id ?? marketList[0]?.id ?? ''}
            returnToMarketId={market?.id ?? null}
          />
        </div>
      </div>
    </>
  );
}
