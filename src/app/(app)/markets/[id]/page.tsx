import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth/guards';
import { getMarketWorkspace } from '@/lib/services/workspace';
import { NotFoundError } from '@/lib/errors';
import { isAiConfigured } from '@/lib/ai/client';
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
        anchors={w.anchors}
        statuses={w.statuses}
        tags={w.tags}
        propertyTypes={w.propertyTypes}
        properties={w.properties}
        parcels={w.parcels}
        aiConfigured={isAiConfigured()}
        isAdmin={actor.role === 'admin'}
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
