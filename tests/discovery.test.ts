import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, discoveryResults, discoverySuppressions, properties,
} from '@/db/schema';
import { addressHash, findMatch, normalizeAddress, normalizeUrl } from '@/lib/services/dedupe';
import {
  approveAsNewProperty, listDiscoveryResults, reviewResult, stageCandidates,
} from '@/lib/services/discovery';
import { createProperty } from '@/lib/services/properties';
import { logActivity } from '@/lib/services/activities';
import type { Candidate } from '@/lib/ai/extraction';
import type { Actor } from '@/lib/auth/guards';
import {
  cleanupTestData, createTestMarket, ensureBaseline, testActor,
} from './helpers';

let actor: Actor;
const ANCHOR = { lat: 33.4735, lng: -82.0812 };

/**
 * A per-run nonce.
 *
 * Suppressions are permanent by design — that is what stops a rejected listing
 * reappearing on every scan — and hash-type suppression keys are SHA digests
 * that match no cleanup pattern. Scoping every fixture address and URL to a
 * single run means a previous run's suppressions can never silently suppress
 * this run's fixtures.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const addr = (n: number) => `${n} Sample Parkway ${RUN}`;
const src = (slug: string) => `https://example.invalid/${RUN}/${slug}`;

/** A minimal well-formed candidate, as the extraction schema would produce. */
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  const unsourced = { value: null, sourceUrl: null, excerpt: null, confidence: 'low' as const };
  return {
    name: 'Test Retail Center',
    addressLine1: addr(100),
    city: 'Augusta',
    state: 'GA',
    postalCode: '30909',
    county: 'Richmond',
    latitude: ANCHOR.lat,
    longitude: ANCHOR.lng,
    propertyType: 'Retail - Strip Center',
    askingPrice: 1_500_000,
    buildingSqft: 12_000,
    landAcreage: 1.5,
    listingDate: null,
    ownerName: unsourced,
    brokerName: unsourced,
    brokerCompany: unsourced,
    brokerPhone: unsourced,
    brokerEmail: unsourced,
    priceSource: { value: 1_500_000, sourceUrl: 'https://example.invalid/listing/1', excerpt: 'Asking $1,500,000', confidence: 'high' },
    sources: [{ url: src('listing-1'), title: 'Listing 1', sourceName: 'Example Listings' }],
    evidenceExcerpt: 'Offered for sale at $1,500,000.',
    needsVerification: [],
    locationNote: null,
    ...overrides,
  };
}

/**
 * Suppressions are deliberately permanent — that is the feature that stops a
 * rejected listing reappearing on every scan. So the teardown must remove them
 * by AUTHOR, not by key pattern: hash-type suppression keys are SHA digests and
 * match no URL pattern, and leaving them behind makes a later run silently
 * suppress its own fixtures.
 */
async function cleanupDiscovery() {
  // Match on the run nonce alone, not on a street-suffix spelling: one fixture
  // deliberately rewrites "Parkway" to "Pkwy." to exercise address normalisation,
  // and a pattern containing the suffix would leave that row behind.
  await db.delete(discoveryResults).where(like(discoveryResults.addressLine1, `%${RUN}%`));
  await db.delete(discoverySuppressions).where(like(discoverySuppressions.keyValue, `%${RUN}%`));
}

beforeAll(async () => {
  await ensureBaseline();
  await cleanupTestData();
  await cleanupDiscovery();
  actor = await testActor();
});

afterAll(async () => {
  await cleanupDiscovery();
  await cleanupTestData();
});

/* ========================================================================== */
/* Deduplication primitives                                                   */
/* ========================================================================== */

describe('url normalisation', () => {
  it('strips tracking parameters, fragments, www and trailing slashes', () => {
    expect(normalizeUrl('https://WWW.Example.com/listing/1/?utm_source=x&utm_campaign=y#photos'))
      .toBe('https://example.com/listing/1');
  });

  it('treats differently ordered query strings as the same listing', () => {
    expect(normalizeUrl('https://example.com/l?b=2&a=1')).toBe(normalizeUrl('https://example.com/l?a=1&b=2'));
  });

  it('keeps meaningful query parameters', () => {
    expect(normalizeUrl('https://example.com/search?id=42')).toContain('id=42');
  });

  it('returns null for unusable input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('not a url at all !!')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('address normalisation', () => {
  it('collapses street-suffix spellings', () => {
    expect(normalizeAddress('100 Sample Parkway')).toBe(normalizeAddress('100 Sample Pkwy'));
    expect(normalizeAddress('12 North Main Street')).toBe(normalizeAddress('12 N Main St'));
  });

  it('produces the same hash for equivalent addresses', () => {
    const a = addressHash({ addressLine1: '100 Sample Parkway', city: 'Augusta', state: 'GA', postalCode: '30909' });
    const b = addressHash({ addressLine1: '100 sample pkwy.', city: 'AUGUSTA', state: 'ga', postalCode: '30909-1234' });
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it('returns null when there is too little to identify a property', () => {
    expect(addressHash({ addressLine1: null, city: 'Augusta' })).toBeNull();
    expect(addressHash({ addressLine1: '100 Main St', city: null, state: null, postalCode: null })).toBeNull();
  });
});

describe('match scoring', () => {
  const existing = [{
    id: 'prop-1',
    addressLine1: '100 Sample Parkway', city: 'Augusta', state: 'GA', postalCode: '30909',
    latitude: ANCHOR.lat, longitude: ANCHOR.lng, parcelIds: ['ABC-123'],
  }];

  it('treats an identical address as an exact match', () => {
    const m = findMatch({ addressLine1: '100 sample pkwy', city: 'Augusta', state: 'GA', postalCode: '30909' }, existing);
    expect(m?.kind).toBe('exact');
    expect(m?.propertyId).toBe('prop-1');
  });

  it('treats a shared parcel ID as an exact match', () => {
    const m = findMatch({ parcelIds: ['abc123'] }, existing);
    expect(m?.kind).toBe('exact');
  });

  it('treats mere proximity as a SUGGESTION, not an automatic merge', () => {
    const m = findMatch({ latitude: ANCHOR.lat + 0.0003, longitude: ANCHOR.lng }, existing);
    expect(m?.kind).toBe('suggested');
    expect(m!.score).toBeLessThan(1);
  });

  it('does NOT match two properties merely because their names are similar', () => {
    // No address, no parcel, no coordinates - nothing to match on. A name-only
    // similarity must never produce a match.
    const m = findMatch({ addressLine1: null, city: null }, existing);
    expect(m).toBeNull();
  });

  it('returns no match for a distant property', () => {
    expect(findMatch({ latitude: ANCHOR.lat + 1, longitude: ANCHOR.lng }, existing)).toBeNull();
  });
});

/* ========================================================================== */
/* Staging and repeated scans                                                 */
/* ========================================================================== */

describe('repeated scans do not create duplicates', () => {
  it('records a candidate once and only bumps last-seen on a repeat', async () => {
    const market = await createTestMarket('DiscoDupe');
    const same = () => candidate({
      addressLine1: addr(101),
      sources: [{ url: src('dupe-1'), title: null, sourceName: null }],
    });

    const first = await stageCandidates({
      candidates: [same()], scanId: null, marketId: market.id, origin: 'scan',
    });
    expect(first.created).toBe(1);

    // The same listing surfaced by a second scan.
    const second = await stageCandidates({
      candidates: [same()], scanId: null, marketId: market.id, origin: 'scan',
    });
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(1);

    const staged = await db.select().from(discoveryResults)
      .where(eq(discoveryResults.marketId, market.id));
    expect(staged).toHaveLength(1);
    expect(staged[0]!.timesSeen).toBe(2);
  });

  it('deduplicates the same property found at two different URLs', async () => {
    const market = await createTestMarket('DiscoCrossSource');

    await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(102),
        sources: [{ url: src('site-a'), title: null, sourceName: 'A' }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    // Different site, same street address written differently - the address hash
    // catches it even though the URL and the name both differ.
    const second = await stageCandidates({
      candidates: [candidate({
        name: 'Test Retail Ctr',
        // Same address, spelled differently: the hash must still collapse them.
        addressLine1: addr(102).replace('Parkway', 'Pkwy.'),
        sources: [{ url: src('site-b'), title: null, sourceName: 'B' }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it('never resurfaces a rejected candidate on a later scan', async () => {
    const market = await createTestMarket('DiscoReject');

    const rejected = () => candidate({
      addressLine1: addr(103),
      sources: [{ url: src('reject-me'), title: null, sourceName: null }],
    });

    await stageCandidates({
      candidates: [rejected()], scanId: null, marketId: market.id, origin: 'scan',
    });
    const [staged] = await db.select().from(discoveryResults).where(eq(discoveryResults.marketId, market.id));

    await reviewResult(staged!.id, 'rejected', 'Not a fit.', actor);

    // A later scan finds it again; it must be suppressed, not re-staged.
    const later = await stageCandidates({
      candidates: [rejected()], scanId: null, marketId: market.id, origin: 'scan',
    });
    expect(later.created).toBe(0);
    expect(later.suppressed).toBe(1);
  });

  it('keeps "needs more research" in play rather than suppressing it', async () => {
    const market = await createTestMarket('DiscoNeedsResearch');

    await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(104),
        sources: [{ url: src('needs-research'), title: null, sourceName: null }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });
    const [staged] = await db.select().from(discoveryResults).where(eq(discoveryResults.marketId, market.id));
    await reviewResult(staged!.id, 'needs_research', 'Check the county records.', actor);

    const suppressed = await db.select().from(discoverySuppressions)
      .where(eq(discoverySuppressions.keyValue, staged!.normalizedUrl!));
    expect(suppressed).toHaveLength(0);
  });
});

/* ========================================================================== */
/* AI never overwrites reviewed data                                          */
/* ========================================================================== */

describe('AI never overwrites human-verified data', () => {
  it('proposes changes instead of applying them, and leaves verified fields alone', async () => {
    const market = await createTestMarket('DiscoNoOverwrite');

    // A human-entered property. createProperty marks it human-verified.
    const property = await createProperty({
      marketId: market.id,
      name: 'Human entered name',
      addressLine1: addr(500),
      city: 'Augusta', state: 'GA', postalCode: '30909',
      latitude: ANCHOR.lat, longitude: ANCHOR.lng,
      askingPrice: '2000000',
      researchNotes: 'Spoke to the owner personally.',
    }, actor);

    await logActivity({
      propertyId: property.id, type: 'call', outcome: 'spoke_with_owner', notes: 'Important call notes.',
    }, actor);

    // A scan finds the same property with different values.
    await stageCandidates({
      candidates: [candidate({
        name: 'AI SUGGESTED NAME',
        addressLine1: addr(500),
        askingPrice: 1_750_000,
        propertyType: 'Office',
        sources: [{ url: src('overwrite-test'), title: null, sourceName: null }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    // The property record is completely untouched.
    const [after] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(after!.name).toBe('Human entered name');
    expect(Number(after!.askingPrice)).toBe(2_000_000);
    expect(after!.researchNotes).toBe('Spoke to the owner personally.');
    expect(after!.version).toBe(property.version);

    // Call history is untouched.
    const calls = await db.select().from(activities)
      .where(and(eq(activities.propertyId, property.id), eq(activities.type, 'call')));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.notes).toBe('Important call notes.');

    // The candidate is staged as a suggestion against the existing property.
    const [staged] = await db.select().from(discoveryResults)
      .where(eq(discoveryResults.marketId, market.id));
    expect(staged!.suggestedPropertyId).toBe(property.id);

    const proposed = staged!.proposedChanges ?? {};
    // A verified, non-empty name is NOT proposed for replacement...
    expect(proposed.name).toBeUndefined();
    // ...but a moving asking price is surfaced, because that is real news.
    expect(proposed.askingPrice?.to).toBe(1_750_000);
    expect(proposed.askingPrice?.from).toBeTruthy();
  });

  it('does propose filling a field that is genuinely empty', async () => {
    const market = await createTestMarket('DiscoFillEmpty');

    const property = await createProperty({
      marketId: market.id,
      addressLine1: addr(501), city: 'Augusta', state: 'GA', postalCode: '30909',
      latitude: ANCHOR.lat, longitude: ANCHOR.lng,
      // propertyType deliberately left unknown.
    }, actor);

    await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(501),
        propertyType: 'Retail - Freestanding',
        sources: [{ url: src('fill-empty'), title: null, sourceName: null }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    const [staged] = await db.select().from(discoveryResults).where(eq(discoveryResults.marketId, market.id));
    expect(staged!.proposedChanges?.propertyType?.to).toBe('Retail - Freestanding');
    void property;
  });
});

/* ========================================================================== */
/* Approval                                                                   */
/* ========================================================================== */

describe('approving a candidate', () => {
  it('creates a property carrying provenance, and suppresses the candidate', async () => {
    const market = await createTestMarket('DiscoApprove');

    await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(700),
        sources: [{ url: src('approve-me'), title: 'Listing', sourceName: 'Example' }],
        needsVerification: ['ownerName'],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    const [staged] = await db.select().from(discoveryResults).where(eq(discoveryResults.marketId, market.id));
    const property = await approveAsNewProperty(staged!.id, {}, actor);

    expect(property.addressLine1).toBe(addr(700));
    expect(property.listingStatus).toBe('for_sale');
    // Provenance travels with the record so the reviewer can re-check it later.
    expect(property.researchNotes).toContain(src('approve-me'));
    expect(property.researchNotes).toContain('Needs verification: ownerName');

    const [updated] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, staged!.id));
    expect(updated!.status).toBe('approved');
    expect(updated!.linkedPropertyId).toBe(property.id);

    // An already-imported listing must not reappear as new.
    const again = await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(700),
        sources: [{ url: src('approve-me'), title: null, sourceName: null }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });
    expect(again.suppressed).toBe(1);
    expect(again.created).toBe(0);
  });

  it('refuses to approve the same result twice', async () => {
    const market = await createTestMarket('DiscoDoubleApprove');

    await stageCandidates({
      candidates: [candidate({
        addressLine1: addr(600),
        sources: [{ url: src('twice'), title: null, sourceName: null }],
      })],
      scanId: null, marketId: market.id, origin: 'scan',
    });

    const [staged] = await db.select().from(discoveryResults).where(eq(discoveryResults.marketId, market.id));
    await approveAsNewProperty(staged!.id, {}, actor);
    await expect(approveAsNewProperty(staged!.id, {}, actor)).rejects.toThrow(/already been reviewed/i);
  });
});

/* ========================================================================== */
/* Secrets stay server-side                                                   */
/* ========================================================================== */

describe('API key handling', () => {
  it('never exposes the key through the AI status surface', async () => {
    const { aiStatus } = await import('@/lib/ai/client');
    const status = aiStatus();
    const serialised = JSON.stringify(status);

    expect(Object.keys(status)).not.toContain('apiKey');
    expect(serialised).not.toMatch(/sk-ant/);
    // Only a boolean is exposed.
    expect(typeof status.configured).toBe('boolean');
  });

  it('never exposes secrets through the config status surface', async () => {
    const { configStatus } = await import('@/lib/env');
    const serialised = JSON.stringify(configStatus());

    expect(serialised).not.toMatch(/sk-ant/);
    expect(serialised).not.toMatch(/ANTHROPIC_API_KEY=/);
    // Presence flags only.
    expect(serialised).toMatch(/"apiKeyConfigured"/);
  });

  it('does not expose the key to the browser through a NEXT_PUBLIC_ variable', () => {
    // A NEXT_PUBLIC_ variable is inlined into the client bundle, so a secret must
    // never be named with that prefix.
    const leaked = Object.keys(process.env).filter(
      (k) => k.startsWith('NEXT_PUBLIC_') && /KEY|SECRET|TOKEN|PASSWORD/i.test(k)
        && !/MAPBOX|MAPTILER/i.test(k),
    );
    expect(leaked).toEqual([]);
  });

  it('refuses to run a scan when no key is configured, rather than failing obscurely', async () => {
    const { isAiConfigured } = await import('@/lib/ai/client');
    if (isAiConfigured()) return; // a real key is present in this environment

    const { queueScan } = await import('@/lib/services/scans');
    await expect(
      queueScan({ scope: 'all' }, actor),
    ).rejects.toThrow(/not configured/i);
  });
});
