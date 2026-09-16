import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, opportunities, opportunityProperties, properties,
  propertyParcels,
} from '@/db/schema';
import {
  createParcel, createProperty, getPropertyDetail, updateParcel, updateProperty,
} from '@/lib/services/properties';
import {
  changeOutreachStatus, getContactedButNotPromoted, getFollowUps, logActivity, setFollowUp,
} from '@/lib/services/activities';
import { promoteToOpportunity, setOpportunityState } from '@/lib/services/opportunities';
import { ConflictError } from '@/lib/errors';
import { areaAcres, pointInGeometry } from '@/lib/geo/polygon';
import type { Actor } from '@/lib/auth/guards';
import {
  cleanupTestData, createTestMarket, ensureBaseline,
  squareAround, stageByKey, statusByKey, testActor,
} from './helpers';

/**
 * Integration tests against the real local PostgreSQL database.
 *
 * Run `npm run db:up && npm run db:migrate && npm run db:seed` first.
 */

let actor: Actor;
const ANCHOR = { lat: 33.4735, lng: -82.0812 };

beforeAll(async () => {
  await ensureBaseline();
  await cleanupTestData();
  actor = await testActor();
});

afterAll(async () => {
  await cleanupTestData();
});

/* ========================================================================== */
/* Parcel persistence                                                         */
/* ========================================================================== */

describe('parcel persistence', () => {
  it('saves a drawn parcel, derives acreage, and reloads it', async () => {
    const market = await createTestMarket('Parcel');
    const property = await createProperty({
      marketId: market.id, name: 'Parcel test', latitude: ANCHOR.lat, longitude: ANCHOR.lng,
    }, actor);

    const geometry = squareAround(ANCHOR, 0.0009);
    const parcel = await createParcel({ propertyId: property.id, geometry, parcelIdText: 'ZZ-1', label: 'Main' }, actor);

    const [reloaded] = await db.select().from(propertyParcels).where(eq(propertyParcels.id, parcel.id));
    expect(reloaded!.geometry).toBeTruthy();
    expect(reloaded!.parcelIdText).toBe('ZZ-1');
    // Acreage derived from the drawn shape when not supplied.
    expect(Number(reloaded!.acreage)).toBeCloseTo(areaAcres(geometry), 1);
    expect(reloaded!.minLatitude).toBeLessThan(ANCHOR.lat);
  });

  it('preserves an edited boundary across reload and bumps the version', async () => {
    const market = await createTestMarket('ParcelEdit');
    const property = await createProperty({
      marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng,
    }, actor);
    const parcel = await createParcel({ propertyId: property.id, geometry: squareAround(ANCHOR, 0.0009) }, actor);

    const bigger = squareAround(ANCHOR, 0.002);
    await updateParcel(parcel.id, { geometry: bigger, version: parcel.version }, actor);

    const [reloaded] = await db.select().from(propertyParcels).where(eq(propertyParcels.id, parcel.id));
    expect(reloaded!.version).toBe(parcel.version + 1);
    expect(Number(reloaded!.acreage)).toBeGreaterThan(Number(parcel.acreage));
    // A point inside the enlarged shape but outside the original is now contained.
    expect(pointInGeometry(reloaded!.geometry!, { lat: ANCHOR.lat + 0.0015, lng: ANCHOR.lng })).toBe(true);
  });

  it('supports MULTIPLE parcels on one property, including one without geometry', async () => {
    const market = await createTestMarket('MultiParcel');
    const property = await createProperty({
      marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng,
    }, actor);

    await createParcel({ propertyId: property.id, geometry: squareAround(ANCHOR, 0.0008), parcelIdText: 'A-1', label: 'Main' }, actor);
    await createParcel({ propertyId: property.id, geometry: squareAround({ lat: ANCHOR.lat + 0.003, lng: ANCHOR.lng }, 0.0008), parcelIdText: 'A-2', label: 'Parking' }, actor);
    // A parcel ID recorded before anyone has drawn its outline.
    await createParcel({ propertyId: property.id, parcelIdText: 'A-3', label: 'Not yet drawn' }, actor);

    const detail = await getPropertyDetail(property.id);
    expect(detail.parcels).toHaveLength(3);
    expect(detail.parcels.filter((p) => p.geometry).length).toBe(2);
    expect(detail.parcels.map((p) => p.parcelIdText).sort()).toEqual(['A-1', 'A-2', 'A-3']);

    // Still one property record, not three.
    const all = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(all).toHaveLength(1);
  });

  it('clears needsParcelOutline once a boundary exists', async () => {
    const market = await createTestMarket('OutlineFlag');
    const property = await createProperty({
      marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng,
    }, actor);

    // A property added as a bare point needs an outline.
    expect(property.needsParcelOutline).toBe(true);

    await createParcel({ propertyId: property.id, geometry: squareAround(ANCHOR, 0.0008) }, actor);
    const [after] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(after!.needsParcelOutline).toBe(false);
  });
});

/* ========================================================================== */
/* Call history and follow-ups                                                */
/* ========================================================================== */

describe('call history and follow-ups', () => {
  it('persists calls with author, outcome and the cold-call detail fields', async () => {
    const market = await createTestMarket('Calls');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    await logActivity({
      propertyId: property.id, type: 'call', outcome: 'spoke_with_owner',
      notes: 'Long conversation.',
      sellerMotivation: 'Retiring.',
      pricingExpectation: 'Low threes.',
      timingNotes: 'After the spring lease.',
      followUpDate: '2026-12-01',
    }, actor);

    const detail = await getPropertyDetail(property.id);
    const call = detail.timeline.find((t) => t.type === 'call');
    expect(call).toBeTruthy();
    expect(call!.outcome).toBe('spoke_with_owner');
    expect(call!.sellerMotivation).toBe('Retiring.');
    expect(call!.pricingExpectation).toBe('Low threes.');
    expect(call!.timingNotes).toBe('After the spring lease.');
    expect(call!.authorLabel).toBe(actor.name);
    // The follow-up was applied to the property itself.
    expect(detail.nextFollowUpDate).toBe('2026-12-01');
  });

  it('NEVER erases call history when the outreach status changes', async () => {
    const market = await createTestMarket('History');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    await logActivity({ propertyId: property.id, type: 'call', outcome: 'no_answer', notes: 'First try' }, actor);
    await logActivity({ propertyId: property.id, type: 'call', outcome: 'voicemail_left', notes: 'Second try' }, actor);

    const before = await db.select().from(activities).where(eq(activities.propertyId, property.id));
    const callsBefore = before.filter((a) => a.type === 'call');
    expect(callsBefore).toHaveLength(2);

    const inConversation = await statusByKey('in_conversation');
    await changeOutreachStatus(property.id, inConversation.id, 'Reached them at last.', actor);
    const monitoring = await statusByKey('monitoring');
    await changeOutreachStatus(property.id, monitoring.id, null, actor);

    const after = await db.select().from(activities).where(eq(activities.propertyId, property.id));
    const callsAfter = after.filter((a) => a.type === 'call');

    // Both original calls, with their notes, are untouched.
    expect(callsAfter).toHaveLength(2);
    expect(callsAfter.map((c) => c.notes).sort()).toEqual(['First try', 'Second try']);
    // And the status changes were APPENDED, not substituted.
    expect(after.filter((a) => a.type === 'status_change')).toHaveLength(2);
  });

  it('keeps the follow-up date across reloads and allows clearing it', async () => {
    const market = await createTestMarket('FollowUp');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    await setFollowUp(property.id, '2026-11-15', actor);
    let [row] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(row!.nextFollowUpDate).toBe('2026-11-15');

    await setFollowUp(property.id, null, actor);
    [row] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(row!.nextFollowUpDate).toBeNull();
  });

  it('sorts properties into overdue / today / upcoming buckets', async () => {
    const market = await createTestMarket('Buckets');
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);

    const overdue = await createProperty({ marketId: market.id, name: 'Overdue', nextFollowUpDate: past }, actor);
    const due = await createProperty({ marketId: market.id, name: 'Today', nextFollowUpDate: today }, actor);
    const soon = await createProperty({ marketId: market.id, name: 'Upcoming', nextFollowUpDate: future }, actor);

    const [o, t, u] = await Promise.all([
      getFollowUps('overdue', { marketId: market.id }),
      getFollowUps('today', { marketId: market.id }),
      getFollowUps('upcoming', { marketId: market.id }),
    ]);

    expect(o.map((r) => r.id)).toContain(overdue.id);
    expect(t.map((r) => r.id)).toContain(due.id);
    expect(u.map((r) => r.id)).toContain(soon.id);
    expect(o.map((r) => r.id)).not.toContain(soon.id);
  });

  it('limits the unscheduled queue to actively pursued properties', async () => {
    const market = await createTestMarket('Unscheduled');
    const ready = await statusByKey('ready_to_contact');   // counts as active pursuit
    const needsResearch = await statusByKey('needs_research'); // does not

    const pursued = await createProperty({ marketId: market.id, name: 'Pursued', outreachStatusId: ready.id }, actor);
    const untouched = await createProperty({ marketId: market.id, name: 'Untouched', outreachStatusId: needsResearch.id }, actor);

    const rows = await getFollowUps('unscheduled', { marketId: market.id });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pursued.id);
    // Without this rule the queue would list every untouched record in the database.
    expect(ids).not.toContain(untouched.id);
  });
});

/* ========================================================================== */
/* Pipeline promotion                                                         */
/* ========================================================================== */

describe('transaction pipeline', () => {
  it('does NOT create an opportunity from routine outreach', async () => {
    const market = await createTestMarket('NoAutoPromote');
    const property = await createProperty({ marketId: market.id, name: 'Routine', latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    // A full outreach sequence: several calls, a status change, a follow-up.
    await logActivity({ propertyId: property.id, type: 'call', outcome: 'no_answer' }, actor);
    await logActivity({ propertyId: property.id, type: 'call', outcome: 'spoke_with_owner', notes: 'Friendly chat.' }, actor);
    await logActivity({ propertyId: property.id, type: 'call', outcome: 'interested_in_selling', notes: 'Said they might sell.' }, actor);
    await changeOutreachStatus(property.id, (await statusByKey('in_conversation')).id, null, actor);
    await setFollowUp(property.id, '2026-12-01', actor);

    // Even "interested in selling" does not put it in the pipeline.
    const opps = await db.select().from(opportunityProperties).where(eq(opportunityProperties.propertyId, property.id));
    expect(opps).toHaveLength(0);

    const contactedNotPromoted = await getContactedButNotPromoted();
    expect(contactedNotPromoted.map((r) => r.id)).toContain(property.id);
  });

  it('creates an opportunity only on explicit promotion, recording reason and date', async () => {
    const market = await createTestMarket('Promote');
    const property = await createProperty({ marketId: market.id, name: 'Promote me', latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    const reason = 'Owner volunteered a price and wants to close before the spring lease renewal.';
    const opp = await promoteToOpportunity({ propertyId: property.id, promotionReason: reason }, actor);

    expect(opp.promotionReason).toBe(reason);
    expect(opp.promotedAt).toBeInstanceOf(Date);
    expect(opp.promotedByLabel).toBe(actor.name);
    expect(opp.state).toBe('active');

    const links = await db.select().from(opportunityProperties).where(eq(opportunityProperties.opportunityId, opp.id));
    expect(links).toHaveLength(1);
    expect(links[0]!.propertyId).toBe(property.id);
    expect(links[0]!.isPrimary).toBe(true);

    // The decision is visible on the property's own timeline.
    const detail = await getPropertyDetail(property.id);
    expect(detail.timeline.some((t) => t.subject === 'Promoted to opportunity')).toBe(true);
    expect(detail.opportunities).toHaveLength(1);
  });

  it('refuses to promote the same property into two active opportunities', async () => {
    const market = await createTestMarket('DoublePromote');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    await promoteToOpportunity({ propertyId: property.id, promotionReason: 'First real opportunity here.' }, actor);
    await expect(
      promoteToOpportunity({ propertyId: property.id, promotionReason: 'Second one, should be refused.' }, actor),
    ).rejects.toThrow(/already in the pipeline/i);
  });

  it('removes from the pipeline and reopens without losing history', async () => {
    const market = await createTestMarket('Reopen');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);
    const opp = await promoteToOpportunity({ propertyId: property.id, promotionReason: 'A genuine opportunity.' }, actor);

    const removed = await setOpportunityState(opp.id, { state: 'removed', reason: 'Owner went quiet.', version: opp.version }, actor);
    expect(removed.state).toBe('removed');
    expect(removed.removedReason).toBe('Owner went quiet.');

    const reopened = await setOpportunityState(opp.id, { state: 'active', version: removed.version }, actor);
    expect(reopened.state).toBe('active');
    expect(reopened.removedAt).toBeNull();

    // The whole history is intact: promotion, removal, reopening.
    const detail = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
    expect(detail[0]!.promotionReason).toBe('A genuine opportunity.');
  });

  it('keeps the property record separate from the opportunity record', async () => {
    const market = await createTestMarket('Separate');
    const property = await createProperty({ marketId: market.id, name: 'Original name', latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);
    const opp = await promoteToOpportunity({
      propertyId: property.id, name: 'Deal name differs', promotionReason: 'A concrete acquisition opportunity.',
    }, actor);

    const [prop] = await db.select().from(properties).where(eq(properties.id, property.id));
    // Promotion did not overwrite anything on the property.
    expect(prop!.name).toBe('Original name');
    expect(opp.name).toBe('Deal name differs');
  });

  it('stages promotion at the configured default stage', async () => {
    const market = await createTestMarket('Stage');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);
    const opp = await promoteToOpportunity({ propertyId: property.id, promotionReason: 'Qualified and worth underwriting.' }, actor);

    const qualified = await stageByKey('qualified');
    expect(opp.stageId).toBe(qualified.id);
  });
});

/* ========================================================================== */
/* Concurrent edit protection                                                 */
/* ========================================================================== */

describe('concurrent edit protection', () => {
  it('rejects a second save made against a stale version', async () => {
    const market = await createTestMarket('Concurrency');
    const property = await createProperty({ marketId: market.id, name: 'Contested', latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);

    // Two users load the same record at version N.
    const staleVersion = property.version;

    // The first save succeeds and moves the version to N+1.
    await updateProperty(property.id, { name: 'Saved by user one', version: staleVersion }, actor);

    // The second save, still holding version N, must be refused - not silently
    // overwrite the first user's work.
    await expect(
      updateProperty(property.id, { name: 'Saved by user two', version: staleVersion }, actor),
    ).rejects.toThrow(ConflictError);

    const [row] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(row!.name).toBe('Saved by user one');
  });

  it('reports the current version so the client can reload and retry', async () => {
    const market = await createTestMarket('ConflictInfo');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);
    await updateProperty(property.id, { name: 'First', version: property.version }, actor);

    try {
      await updateProperty(property.id, { name: 'Second', version: property.version }, actor);
      expect.unreachable('a stale write must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).currentVersion).toBe(property.version + 1);
    }
  });

  it('protects parcel edits the same way', async () => {
    const market = await createTestMarket('ParcelConcurrency');
    const property = await createProperty({ marketId: market.id, latitude: ANCHOR.lat, longitude: ANCHOR.lng }, actor);
    const parcel = await createParcel({ propertyId: property.id, geometry: squareAround(ANCHOR, 0.001) }, actor);

    await updateParcel(parcel.id, { label: 'Renamed once', version: parcel.version }, actor);
    await expect(
      updateParcel(parcel.id, { label: 'Renamed twice', version: parcel.version }, actor),
    ).rejects.toThrow(ConflictError);
  });
});

/* ========================================================================== */
/* Unknown vs zero                                                            */
/* ========================================================================== */

describe('unknown values are never stored as zero', () => {
  it('leaves unspecified financial and physical fields NULL', async () => {
    const market = await createTestMarket('Nulls');
    const property = await createProperty({ marketId: market.id, name: 'Sparse' }, actor);

    const [row] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(row!.askingPrice).toBeNull();
    expect(row!.noi).toBeNull();
    expect(row!.capRateReported).toBeNull();
    expect(row!.buildingSqft).toBeNull();
    expect(row!.landAcreage).toBeNull();
    expect(row!.occupancyPercent).toBeNull();
    expect(row!.listingDate).toBeNull();
  });

  it('stores a real zero when a zero is genuinely meant', async () => {
    const market = await createTestMarket('RealZero');
    const property = await createProperty({ marketId: market.id, noi: '0', occupancyPercent: '0' }, actor);

    const [row] = await db.select().from(properties).where(eq(properties.id, property.id));
    expect(Number(row!.noi)).toBe(0);
    expect(Number(row!.occupancyPercent)).toBe(0);
    // Distinguishable from unknown, which stays NULL.
    expect(row!.askingPrice).toBeNull();
  });
});
