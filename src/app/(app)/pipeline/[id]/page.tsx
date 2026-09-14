import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, isNull } from 'drizzle-orm';
import { ArrowLeft, Building2 } from 'lucide-react';
import { db } from '@/db';
import { transactionStages } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { getOpportunityDetail } from '@/lib/services/opportunities';
import { NotFoundError } from '@/lib/errors';
import { formatAddress, formatDate, formatDateTime, formatMoney, propertyTitle } from '@/lib/format';
import { Field, SampleBadge, StatusChip, Value } from '@/components/ui/primitives';
import { OpportunityEditor } from './opportunity-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const o = await getOpportunityDetail((await params).id);
    return { title: o.name };
  } catch {
    return { title: 'Opportunity' };
  }
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;

  let opportunity: Awaited<ReturnType<typeof getOpportunityDetail>>;
  try {
    opportunity = await getOpportunityDetail(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const stages = await db.select().from(transactionStages)
    .where(isNull(transactionStages.archivedAt))
    .orderBy(asc(transactionStages.sortOrder));

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/pipeline" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Pipeline
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">{opportunity.name}</h1>
          {opportunity.isSample && <SampleBadge />}
          <StatusChip label={opportunity.stageLabel} color={opportunity.stageColor} />
          {opportunity.state === 'removed' && (
            <span className="chip border-ink-300 bg-ink-100 text-ink-600">Removed from active pipeline</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {opportunity.marketName ?? 'No market'} · promoted {formatDate(opportunity.promotedAt)} by{' '}
          {opportunity.promotedByLabel ?? 'unknown'}
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <section className="card">
              <div className="card-header"><h2 className="card-title">Why this was promoted</h2></div>
              <div className="p-4">
                <p className="text-sm whitespace-pre-wrap text-ink-800">{opportunity.promotionReason}</p>
                <p className="mt-2 text-[11px] text-ink-400">
                  Recorded {formatDateTime(opportunity.promotedAt)} by {opportunity.promotedByLabel ?? 'unknown'}.
                  This record is separate from the property, so a future deal on the same
                  property will not overwrite it.
                </p>
              </div>
            </section>

            <OpportunityEditor
              opportunity={{
                id: opportunity.id,
                version: opportunity.version,
                name: opportunity.name,
                stageId: opportunity.stageId,
                state: opportunity.state,
                targetPrice: opportunity.targetPrice,
                offerPrice: opportunity.offerPrice,
                contractPrice: opportunity.contractPrice,
                expectedCloseDate: opportunity.expectedCloseDate,
                nextStep: opportunity.nextStep,
                nextStepDate: opportunity.nextStepDate,
                notes: opportunity.notes,
              }}
              stages={stages.map((s) => ({ id: s.id, label: s.label, color: s.color, isTerminal: s.isTerminal }))}
            />

            <section className="card">
              <div className="card-header"><h2 className="card-title">Stage history</h2></div>
              {opportunity.history.length === 0 ? (
                <p className="p-4 text-xs text-ink-500">No stage changes recorded.</p>
              ) : (
                <ol className="divide-y divide-ink-100">
                  {opportunity.history.map((h) => (
                    <li key={h.id} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-ink-800">
                          {h.fromStageLabel ? `${h.fromStageLabel} → ${h.toStageLabel}` : `Entered ${h.toStageLabel ?? 'pipeline'}`}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-400">{formatDateTime(h.changedAt)}</span>
                      </div>
                      {h.note && <p className="mt-0.5 text-xs text-ink-600">{h.note}</p>}
                      <div className="text-[11px] text-ink-400">{h.changedByLabel ?? 'Unknown'}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="space-y-5">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Properties</h2>
                <span className="text-[11px] text-ink-500">{opportunity.properties.length}</span>
              </div>
              <ul className="divide-y divide-ink-100">
                {opportunity.properties.map((p) => (
                  <li key={p.id} className="p-3">
                    <Link href={`/properties/${p.id}`} className="block">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink-900 hover:text-accent-700">
                            {propertyTitle(p)}
                          </span>
                          <span className="block truncate text-[11px] text-ink-500">{formatAddress(p)}</span>
                        </span>
                        {p.isPrimary && (
                          <span className="chip shrink-0 border-accent-200 bg-accent-50 text-accent-700">Primary</span>
                        )}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                        <span>Asking: <Value mono>{formatMoney(p.askingPrice)}</Value></span>
                        <span>NOI: <Value mono>{formatMoney(p.noi)}</Value></span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="border-t border-ink-100 p-3">
                <p className="text-[11px] text-ink-500">
                  <Building2 size={11} className="mr-1 inline" />
                  An opportunity can span several properties or parcels. Call history and
                  notes stay on each property record.
                </p>
              </div>
            </section>

            <section className="card">
              <div className="card-header"><h2 className="card-title">Deal figures</h2></div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <Field label="Target price"><Value mono>{formatMoney(opportunity.targetPrice)}</Value></Field>
                <Field label="Offer price"><Value mono>{formatMoney(opportunity.offerPrice)}</Value></Field>
                <Field label="Contract price"><Value mono>{formatMoney(opportunity.contractPrice)}</Value></Field>
                <Field label="Expected close"><Value>{formatDate(opportunity.expectedCloseDate)}</Value></Field>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
