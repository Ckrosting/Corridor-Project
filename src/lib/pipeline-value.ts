import { toNumber } from '@/lib/format';

interface DealPrices {
  targetPrice: string | null;
  offerPrice: string | null;
  contractPrice: string | null;
}

/**
 * The deal's current value: whatever the furthest-along price field says, because
 * a signed contract price supersedes an offer, which supersedes the target.
 */
export function dealValue(o: DealPrices): number | null {
  return toNumber(o.contractPrice) ?? toNumber(o.offerPrice) ?? toNumber(o.targetPrice);
}

export function pipelineTotal(items: DealPrices[]): number {
  return items.reduce((sum, o) => sum + (dealValue(o) ?? 0), 0);
}
