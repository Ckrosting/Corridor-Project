import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth/guards';
import { getCorridorWorkspace } from '@/lib/services/workspace';
import { NotFoundError } from '@/lib/errors';
import { isAiConfigured } from '@/lib/ai/client';
import { CorridorWorkspace } from '@/components/workspace/corridor-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { corridor } = await getCorridorWorkspace((await params).id);
    return { title: corridor.name };
  } catch {
    return { title: 'Corridor' };
  }
}

export default async function CorridorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageUser();
  const { id } = await params;

  try {
    const w = await getCorridorWorkspace(id);
    return (
      <CorridorWorkspace
        corridor={w.corridor}
        market={w.market}
        siblingCorridors={w.siblingCorridors}
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
