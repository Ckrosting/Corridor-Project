/**
 * Seeds baseline configuration (statuses, stages, settings, first admin) and,
 * with --demo, a set of CLEARLY LABELLED sample records.
 *
 * Safe to re-run: baseline rows are upserted by key, and demo data is removed and
 * rebuilt rather than duplicated. Real records are never touched.
 *
 *   npm run db:seed          baseline only
 *   npm run db:seed:demo     baseline + sample data
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql as raw } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { areaAcres, computeBBox, validateAreaGeometry } from '../src/lib/geo/polygon';

const {
  users, appSettings, outreachStatuses, transactionStages, markets, mallAnchors,
  properties, propertyParcels, contacts, ownerEntities,
  propertyContacts, activities, tags, propertyTags, opportunities, opportunityProperties,
  opportunityStageHistory, discoveryResults, customFieldDefs,
} = schema;

const OUTREACH_STATUSES = [
  { key: 'needs_research',   label: 'Needs Research',        color: '#94a3b8', sortOrder: 10, isDefault: true,  countsAsActivePursuit: false },
  { key: 'ready_to_contact', label: 'Ready to Contact',      color: '#0ea5e9', sortOrder: 20, isDefault: false, countsAsActivePursuit: true },
  { key: 'attempted',        label: 'Attempted Contact',     color: '#f59e0b', sortOrder: 30, isDefault: false, countsAsActivePursuit: true },
  { key: 'in_conversation',  label: 'In Conversation',       color: '#22c55e', sortOrder: 40, isDefault: false, countsAsActivePursuit: true },
  { key: 'follow_up_later',  label: 'Follow Up Later',       color: '#8b5cf6', sortOrder: 50, isDefault: false, countsAsActivePursuit: true },
  { key: 'monitoring',       label: 'Monitoring',            color: '#64748b', sortOrder: 60, isDefault: false, countsAsActivePursuit: false },
  { key: 'passed',           label: 'Not Interested / Passed', color: '#ef4444', sortOrder: 70, isDefault: false, countsAsActivePursuit: false },
];

const TRANSACTION_STAGES = [
  { key: 'qualified',   label: 'Qualified Opportunity',   color: '#0ea5e9', sortOrder: 10, isDefault: true,  isTerminal: false, category: 'open' },
  { key: 'underwriting', label: 'Evaluating / Underwriting', color: '#6366f1', sortOrder: 20, isDefault: false, isTerminal: false, category: 'open' },
  { key: 'pricing',     label: 'Pricing Discussions',     color: '#8b5cf6', sortOrder: 30, isDefault: false, isTerminal: false, category: 'open' },
  { key: 'loi',         label: 'Offer / LOI',             color: '#f59e0b', sortOrder: 40, isDefault: false, isTerminal: false, category: 'open' },
  { key: 'under_contract', label: 'Under Contract',       color: '#14b8a6', sortOrder: 50, isDefault: false, isTerminal: false, category: 'open' },
  { key: 'due_diligence', label: 'Due Diligence',         color: '#0891b2', sortOrder: 60, isDefault: false, isTerminal: false, category: 'open' },
  { key: 'closed',      label: 'Closed',                  color: '#16a34a', sortOrder: 70, isDefault: false, isTerminal: true,  category: 'closed_won' },
  { key: 'on_hold',     label: 'On Hold',                 color: '#a16207', sortOrder: 80, isDefault: false, isTerminal: true,  category: 'on_hold' },
  { key: 'dead',        label: 'Dead / Passed',           color: '#dc2626', sortOrder: 90, isDefault: false, isTerminal: true,  category: 'closed_lost' },
];

const DEFAULT_SETTINGS: Array<{ key: string; value: unknown }> = [
  {
    key: 'property_types',
    value: [
      'Retail - Strip Center', 'Retail - Freestanding', 'Retail - Outparcel',
      'Shopping Center', 'Office', 'Industrial / Warehouse', 'Flex',
      'Land - Commercial', 'Multifamily', 'Hospitality', 'Medical', 'Mixed Use', 'Other',
    ],
  },
  // flagged 'edge' for human review rather than discarded as outside.
  {
    // Estimated USD per million tokens, used only to report APPROXIMATE spend.
    // Matches Claude Sonnet 5 list pricing at the time of writing; admins can
    // change these in Settings when pricing or the configured model changes.
    key: 'ai_cost_rates',
    value: { inputPerMTok: 2, outputPerMTok: 10, webSearchPerThousand: 10 },
  },
];

async function main() {
  const withDemo = process.argv.includes('--demo');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[seed] DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });

  try {
    /* ---------------- Baseline configuration ---------------- */

    for (const s of OUTREACH_STATUSES) {
      await db.insert(outreachStatuses).values(s)
        .onConflictDoUpdate({ target: outreachStatuses.key, set: { label: s.label, color: s.color, sortOrder: s.sortOrder, countsAsActivePursuit: s.countsAsActivePursuit } });
    }
    console.log(`[seed] Outreach statuses: ${OUTREACH_STATUSES.length}`);

    for (const s of TRANSACTION_STAGES) {
      await db.insert(transactionStages).values(s)
        .onConflictDoUpdate({ target: transactionStages.key, set: { label: s.label, color: s.color, sortOrder: s.sortOrder, isTerminal: s.isTerminal, category: s.category } });
    }
    console.log(`[seed] Transaction stages: ${TRANSACTION_STAGES.length}`);

    for (const s of DEFAULT_SETTINGS) {
      await db.insert(appSettings).values({ key: s.key, value: s.value as never })
        .onConflictDoNothing({ target: appSettings.key });
    }
    console.log(`[seed] Settings keys: ${DEFAULT_SETTINGS.length}`);

    /* ---------------- First admin ---------------- */

    const adminEmail = (process.env.SEED_ADMIN_EMAIL || process.env.DEV_AUTH_EMAIL || 'admin@localhost').toLowerCase();
    const adminName = process.env.SEED_ADMIN_NAME || 'Administrator';
    const [existing] = await db.select().from(users).where(raw`lower(${users.email}) = ${adminEmail}`).limit(1);

    if (existing) {
      if (existing.role !== 'admin') {
        await db.update(users).set({ role: 'admin' }).where(eq(users.id, existing.id));
        console.log(`[seed] Promoted ${adminEmail} to admin`);
      } else {
        console.log(`[seed] Admin already exists: ${adminEmail}`);
      }
    } else {
      // A generated password is printed exactly once. Never stored in plain text.
      const generated = !process.env.SEED_ADMIN_PASSWORD;
      const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
      await db.insert(users).values({
        email: adminEmail,
        name: adminName,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'admin',
      });
      console.log(`\n[seed] Created admin account: ${adminEmail}`);
      if (generated) {
        console.log('[seed] ----------------------------------------------------------');
        console.log(`[seed]   TEMPORARY PASSWORD: ${password}`);
        console.log('[seed]   Shown once. Sign in and change it, or set SEED_ADMIN_PASSWORD.');
        console.log('[seed] ----------------------------------------------------------\n');
      }
    }

    const [adminUser] = await db.select().from(users).where(raw`lower(${users.email}) = ${adminEmail}`).limit(1);

    /* ---------------- Demo data ---------------- */

    if (!withDemo) {
      console.log('[seed] Done (baseline only). Add --demo for sample records.');
      return;
    }

    console.log('[seed] Rebuilding sample data...');
    // Remove previous sample rows only. Real records are matched by is_sample=false
    // and are never touched by this script.
    await db.delete(opportunities).where(eq(opportunities.isSample, true));
    await db.delete(discoveryResults).where(eq(discoveryResults.isSample, true));
    await db.delete(properties).where(eq(properties.isSample, true));
    await db.delete(markets).where(raw`${markets.slug} like 'sample-%'`);

    const statusByKey = Object.fromEntries(
      (await db.select().from(outreachStatuses)).map((s) => [s.key, s.id]),
    );
    const stageByKey = Object.fromEntries(
      (await db.select().from(transactionStages)).map((s) => [s.key, s]),
    );

    const [market] = await db.insert(markets).values({
      name: 'SAMPLE - Augusta, GA',
      slug: 'sample-augusta-ga',
      state: 'GA',
      notes: 'Demonstration market. All records under it are sample data and can be deleted safely.',
      createdBy: adminUser?.id,
    }).returning();

    const anchorPoint = { lat: 33.4735, lng: -82.0812 };
    const [anchor] = await db.insert(mallAnchors).values({
      marketId: market!.id,
      name: 'SAMPLE - Riverbend Mall',
      addressLine1: '3450 Sample Parkway',
      city: 'Augusta', state: 'GA', postalCode: '30909', county: 'Richmond',
      latitude: anchorPoint.lat, longitude: anchorPoint.lng,
      needsMapPlacement: false,
      locationSource: 'imported',
      locationSetAt: new Date(),
      createdBy: adminUser?.id,
    }).returning();

    const [ownerEntity] = await db.insert(ownerEntities).values({
      name: 'SAMPLE - Maple Ridge Holdings, LLC',
      entityType: 'LLC',
      mailingAddress: 'PO Box 1234, Augusta, GA 30903',
      source: 'Sample data',
      createdBy: adminUser?.id,
    }).returning();

    const [broker] = await db.insert(contacts).values({
      name: 'SAMPLE - Dana Whitfield', company: 'Sample Commercial Advisors',
      role: 'broker', title: 'Senior Associate',
      phone: '(555) 0100-2200', email: 'sample.broker@example.invalid',
      source: 'Sample data', createdBy: adminUser?.id,
    }).returning();

    const [owner] = await db.insert(contacts).values({
      name: 'SAMPLE - R. Alvarez', company: 'Maple Ridge Holdings, LLC',
      role: 'owner', title: 'Managing Member',
      phone: '(555) 0100-3311', email: 'sample.owner@example.invalid',
      ownerEntityId: ownerEntity!.id,
      source: 'Sample data', createdBy: adminUser?.id,
    }).returning();

    const [tagHighPriority] = await db.insert(tags).values({ name: 'SAMPLE High Priority', color: '#dc2626' })
      .onConflictDoNothing().returning();

    const demoProps = [
      {
        name: 'SAMPLE - Riverbend Corner Retail', addressLine1: '3401 Sample Parkway',
        lat: 33.4748, lng: -82.0795, type: 'Retail - Strip Center',
        status: 'in_conversation', listing: 'off_market' as const,
        askingPrice: null, target: '2750000.00', sellerIndicated: '3100000.00',
        noi: '214000.00', capReported: null, sqft: 18400, acres: '2.1000',
        occupancy: '86.00', tenants: 'Three local tenants; one vacancy at the end unit.',
        notes: 'Owner answered directly. Open to a conversation but not formally marketing.',
        followUpDays: 3,
      },
      {
        name: 'SAMPLE - Washington Road Outparcel', addressLine1: '2870 Washington Road',
        lat: 33.4802, lng: -82.0731, type: 'Retail - Outparcel',
        status: 'ready_to_contact', listing: 'for_sale' as const,
        askingPrice: '1450000.00', target: null, sellerIndicated: null,
        noi: '96500.00', capReported: '6.650', sqft: 4200, acres: '0.9000',
        occupancy: '100.00', tenants: 'Single tenant, quick-service restaurant.',
        notes: 'Listed. Broker flyer received. Reported cap rate is broker-stated, not verified.',
        followUpDays: -2, // deliberately overdue, to exercise the follow-up views
      },
      {
        name: 'SAMPLE - Sample Parkway Flex Building', addressLine1: '3610 Sample Parkway',
        lat: 33.4690, lng: -82.0860, type: 'Flex',
        status: 'needs_research', listing: 'unknown' as const,
        askingPrice: null, target: null, sellerIndicated: null,
        noi: null, capReported: null, sqft: 31000, acres: '3.4000',
        occupancy: null, tenants: null,
        notes: 'Spotted while driving the market. No ownership research done yet.',
        followUpDays: null,
      },
    ];

    let createdProps = 0;
    const propIds: string[] = [];

    for (const p of demoProps) {
      const [prop] = await db.insert(properties).values({
        marketId: market!.id, name: p.name, addressLine1: p.addressLine1,
        city: 'Augusta', state: 'GA', postalCode: '30909', county: 'Richmond',
        latitude: p.lat, longitude: p.lng, locationSource: 'manual',
        locationConfidence: 'high', needsMapPlacement: false,
        propertyType: p.type,
        landAcreage: p.acres, buildingSqft: p.sqft,
        occupancyPercent: p.occupancy, tenantInfo: p.tenants,
        askingPrice: p.askingPrice, targetPurchasePrice: p.target,
        sellerIndicatedPrice: p.sellerIndicated, noi: p.noi,
        capRateReported: p.capReported,
        capRateReportedSource: p.capReported ? 'Broker flyer (sample)' : null,
        ownerEntityId: ownerEntity!.id,
        listingStatus: p.listing,
        outreachStatusId: statusByKey[p.status],
        researchNotes: p.notes,
        nextFollowUpDate: p.followUpDays === null || p.followUpDays === undefined
          ? null
          : new Date(Date.now() + p.followUpDays * 864e5).toISOString().slice(0, 10),
        needsParcelOutline: false,
        isSample: true,
        createdBy: adminUser?.id,
      }).returning();

      propIds.push(prop!.id);
      createdProps++;

      // A small parcel square around the point.
      const d = 0.0009;
      const parcel = validateAreaGeometry({
        type: 'Polygon',
        coordinates: [[
          [p.lng - d, p.lat - d], [p.lng + d, p.lat - d],
          [p.lng + d, p.lat + d], [p.lng - d, p.lat + d], [p.lng - d, p.lat - d],
        ]],
      });
      const pb = computeBBox(parcel);
      await db.insert(propertyParcels).values({
        propertyId: prop!.id, parcelIdText: `SAMPLE-${1000 + createdProps}`,
        label: 'Main parcel', geometry: parcel, geometrySource: 'manual_draw',
        // Derived from the drawn shape, exactly as the app does when a user draws one.
        acreage: areaAcres(parcel).toFixed(4),
        minLatitude: pb.minLat, maxLatitude: pb.maxLat,
        minLongitude: pb.minLng, maxLongitude: pb.maxLng,
        createdBy: adminUser?.id,
      });

      await db.insert(propertyContacts).values([
        { propertyId: prop!.id, contactId: broker!.id, relationship: 'broker', isPrimary: p.listing === 'for_sale' },
        { propertyId: prop!.id, contactId: owner!.id, relationship: 'owner', isPrimary: p.listing !== 'for_sale' },
      ]).onConflictDoNothing();
    }

    // The first sample property gets a SECOND parcel, demonstrating multi-parcel support.
    const extra = validateAreaGeometry({
      type: 'Polygon',
      coordinates: [[
        [-82.0782, 33.4744], [-82.0770, 33.4744],
        [-82.0770, 33.4753], [-82.0782, 33.4753], [-82.0782, 33.4744],
      ]],
    });
    const eb = computeBBox(extra);
    await db.insert(propertyParcels).values({
      propertyId: propIds[0]!, parcelIdText: 'SAMPLE-1000-B', label: 'Adjacent parking parcel',
      geometry: extra, geometrySource: 'manual_draw',
      acreage: areaAcres(extra).toFixed(4),
      minLatitude: eb.minLat, maxLatitude: eb.maxLat,
      minLongitude: eb.minLng, maxLongitude: eb.maxLng,
      createdBy: adminUser?.id,
    });

    if (tagHighPriority) {
      await db.insert(propertyTags).values({ propertyId: propIds[0]!, tagId: tagHighPriority.id }).onConflictDoNothing();
    }

    // Call history on the first property.
    await db.insert(activities).values([
      {
        propertyId: propIds[0]!, type: 'call', outcome: 'no_answer',
        occurredAt: new Date(Date.now() - 12 * 864e5),
        subject: 'First attempt', notes: 'No answer on the listed number. Left no message.',
        authorUserId: adminUser?.id, authorLabel: adminUser?.name ?? 'Sample',
      },
      {
        propertyId: propIds[0]!, type: 'call', outcome: 'voicemail_left',
        occurredAt: new Date(Date.now() - 9 * 864e5),
        subject: 'Second attempt', notes: 'Left a voicemail introducing ourselves as the mall owner across the street.',
        authorUserId: adminUser?.id, authorLabel: adminUser?.name ?? 'Sample',
      },
      {
        propertyId: propIds[0]!, type: 'call', outcome: 'spoke_with_owner',
        contactId: owner!.id,
        occurredAt: new Date(Date.now() - 4 * 864e5),
        subject: 'Reached the owner',
        notes: 'Spoke about 10 minutes. Has owned it since 2011. Not actively marketing.',
        sellerMotivation: 'Wants to simplify holdings before retiring; no urgency.',
        pricingExpectation: 'Mentioned "low threes" unprompted.',
        timingNotes: 'Would revisit after the end-unit lease is resolved in the spring.',
        priceMentioned: '3100000.00',
        followUpDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        authorUserId: adminUser?.id, authorLabel: adminUser?.name ?? 'Sample',
      },
    ]);

    // ONE sample opportunity, explicitly promoted with a reason. Note that the
    // other sample properties have call history and follow-ups but are NOT here -
    // routine outreach does not enter the pipeline.
    const [opp] = await db.insert(opportunities).values({
      name: 'SAMPLE - Riverbend Corner Retail acquisition',
      marketId: market!.id,
      stageId: stageByKey['pricing']!.id,
      state: 'active',
      promotionReason: 'Owner volunteered a price expectation and is open to selling after the spring lease resolution.',
      promotedAt: new Date(Date.now() - 3 * 864e5),
      promotedBy: adminUser?.id,
      promotedByLabel: adminUser?.name ?? 'Sample',
      targetPrice: '2750000.00',
      nextStep: 'Send an indicative range and confirm the lease timing.',
      nextStepDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
      isSample: true,
      createdBy: adminUser?.id,
    }).returning();

    await db.insert(opportunityProperties).values({ opportunityId: opp!.id, propertyId: propIds[0]!, isPrimary: true });
    await db.insert(opportunityStageHistory).values([
      {
        opportunityId: opp!.id, toStageId: stageByKey['qualified']!.id,
        toStageLabel: stageByKey['qualified']!.label, note: 'Promoted from the property panel.',
        changedBy: adminUser?.id, changedByLabel: adminUser?.name ?? 'Sample',
        changedAt: new Date(Date.now() - 3 * 864e5),
      },
      {
        opportunityId: opp!.id, fromStageId: stageByKey['qualified']!.id, toStageId: stageByKey['pricing']!.id,
        fromStageLabel: stageByKey['qualified']!.label, toStageLabel: stageByKey['pricing']!.label,
        note: 'Owner gave a price expectation.',
        changedBy: adminUser?.id, changedByLabel: adminUser?.name ?? 'Sample',
        changedAt: new Date(Date.now() - 1 * 864e5),
      },
    ]);

    // A sample custom field, to show the mechanism.
    await db.insert(customFieldDefs).values({
      entity: 'property', key: 'drive_by_condition', label: 'Drive-by Condition',
      type: 'select', options: ['Excellent', 'Good', 'Fair', 'Poor', 'Not assessed'],
      helpText: 'Visual condition noted during a drive-by.', sortOrder: 10,
    }).onConflictDoNothing();

    console.log(`[seed] Sample data: 1 market, 1 anchor, ${createdProps} properties, 4 parcels, 2 contacts, 3 calls, 1 opportunity`);
    console.log('[seed] All sample records are prefixed "SAMPLE" and flagged is_sample=true.');
  } catch (err) {
    console.error('[seed] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 10 });
  }
}

void main();
