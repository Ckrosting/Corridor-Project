import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth/guards';
import { getMarketWorkspace } from '@/lib/services/workspace';
import { NotFoundError } from '@/lib/errors';
import { MarketWorkspace } from '@/components/workspace/market-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { market } = await getMarketWorkspace((await params).id);
    return { title: market.name };
  } catch {
    return { title: 'Market' };
  }
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageUser();
  const { id } = await params;

  try {
    const w = await getMarketWorkspace(id);
    return (
      <MarketWorkspace
        market={w.market}
        corridors={w.corridors}
        anchors={w.anchors}
        properties={w.properties}
        parcels={w.parcels}
        statuses={w.statuses}
        isAdmin={actor.role === 'admin'}
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
