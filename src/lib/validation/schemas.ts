import { z } from 'zod';

/**
 * Server-side validation for every write. These schemas are the single source of
 * truth: API routes validate with them before touching the database, so a
 * hand-crafted request cannot bypass the rules the UI enforces.
 *
 * Optional numeric fields use `nullish` rather than defaulting to 0 — an absent
 * value must stay absent, never become a fabricated zero.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max).nullish().transform((v) => (v === '' || v === undefined ? null : v));

/**
 * Accepts "", null, "1234.50" or 1234.5 and yields a decimal string or null.
 *
 * `.optional()` (rather than a `z.undefined()` union member) is required so Zod
 * treats the key as genuinely optional - a key entirely absent from the request
 * body (as opposed to present with value `undefined`) otherwise fails with
 * "expected nonoptional" even though every value this field accepts already
 * folds down to `null`.
 */
const optionalDecimal = (opts: { min?: number; max?: number } = {}) =>
  z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a number.' });
      return null;
    }
    if (opts.min !== undefined && n < opts.min) {
      ctx.addIssue({ code: 'custom', message: `Must be at least ${opts.min}.` });
      return null;
    }
    if (opts.max !== undefined && n > opts.max) {
      ctx.addIssue({ code: 'custom', message: `Must be at most ${opts.max}.` });
      return null;
    }
    return n.toString();
  });

/** See `optionalDecimal` above for why `.optional()` replaces a `z.undefined()` union member. */
const optionalInt = (opts: { min?: number; max?: number } = {}) =>
  z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isInteger(n)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a whole number.' });
      return null;
    }
    if (opts.min !== undefined && n < opts.min) {
      ctx.addIssue({ code: 'custom', message: `Must be at least ${opts.min}.` });
      return null;
    }
    if (opts.max !== undefined && n > opts.max) {
      ctx.addIssue({ code: 'custom', message: `Must be at most ${opts.max}.` });
      return null;
    }
    return n;
  });

/** See `optionalDecimal` above for why `.optional()` replaces a `z.undefined()` union member. */
const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === '') return null;
    const s = v.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T12:00:00Z`).getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Must be a date in YYYY-MM-DD form.' });
      return null;
    }
    return s;
  });

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const uuid = z.string().uuid();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour like #2563eb');

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** Shape-only check; validateAreaGeometry() does the real geometric validation. */
export const areaGeometrySchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.unknown()).min(1),
});

/* -------------------------------------------------------------------------- */
/* Markets and anchors                                                        */
/* -------------------------------------------------------------------------- */

export const marketCreateSchema = z.object({
  name: trimmed(160).min(1, 'Market name is required.'),
  state: optionalText(2),
  notes: optionalText(4000),
});

export const marketUpdateSchema = marketCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const mallAnchorCreateSchema = z.object({
  marketId: uuid,
  name: trimmed(160).min(1, 'Mall name is required.'),
  addressLine1: optionalText(240),
  city: optionalText(120),
  state: optionalText(2),
  postalCode: optionalText(12),
  county: optionalText(120),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
  notes: optionalText(4000),
});

export const mallAnchorUpdateSchema = mallAnchorCreateSchema.omit({ marketId: true }).partial().extend({
  version: z.number().int().positive(),
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export const propertyFieldsSchema = z.object({
  name: optionalText(240),
  addressLine1: optionalText(240),
  addressLine2: optionalText(240),
  city: optionalText(120),
  state: optionalText(2),
  postalCode: optionalText(12),
  county: optionalText(120),

  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
  locationSource: optionalText(60),
  locationConfidence: z.enum(['high', 'medium', 'low']).nullish(),

  propertyType: optionalText(80),
  landAcreage: optionalDecimal({ min: 0, max: 1_000_000 }),
  buildingSqft: optionalInt({ min: 0, max: 100_000_000 }),
  occupancyPercent: optionalDecimal({ min: 0, max: 100 }),
  tenantInfo: optionalText(8000),
  yearBuilt: optionalInt({ min: 1600, max: 2200 }),

  askingPrice: optionalDecimal({ min: 0 }),
  targetPurchasePrice: optionalDecimal({ min: 0 }),
  sellerIndicatedPrice: optionalDecimal({ min: 0 }),
  noi: optionalDecimal(),
  capRateReported: optionalDecimal({ min: 0, max: 100 }),
  capRateReportedSource: optionalText(240),

  ownerEntityId: uuid.nullish(),
  listingStatus: z.enum(['off_market', 'for_sale', 'under_contract', 'sold', 'withdrawn', 'unknown']).optional(),
  listingDate: optionalDate,

  outreachStatusId: uuid.nullish(),
  nextFollowUpDate: optionalDate,
  researchNotes: optionalText(20000),
  lastVerifiedAt: z.string().datetime().nullish(),
});

export const propertyCreateSchema = propertyFieldsSchema.extend({
  marketId: uuid,
  tagIds: z.array(uuid).max(50).optional(),
});

export const propertyUpdateSchema = propertyFieldsSchema.partial().extend({
  version: z.number().int().positive(),
  tagIds: z.array(uuid).max(50).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Parcels                                                                    */
/* -------------------------------------------------------------------------- */

export const parcelCreateSchema = z.object({
  propertyId: uuid,
  parcelIdText: optionalText(120),
  label: optionalText(160),
  /** Optional: a parcel ID can be recorded long before anyone draws its outline. */
  geometry: areaGeometrySchema.nullish(),
  acreage: optionalDecimal({ min: 0, max: 1_000_000 }),
  notes: optionalText(4000),
});

export const parcelUpdateSchema = parcelCreateSchema.omit({ propertyId: true }).partial().extend({
  version: z.number().int().positive(),
});

/* -------------------------------------------------------------------------- */
/* Contacts                                                                   */
/* -------------------------------------------------------------------------- */

const contactRole = z.enum(['owner', 'broker', 'representative', 'property_manager', 'tenant', 'attorney', 'other']);

export const contactCreateSchema = z.object({
  name: trimmed(200).min(1, 'Contact name is required.'),
  company: optionalText(200),
  role: contactRole.default('other'),
  title: optionalText(160),
  phone: optionalText(60),
  phoneAlt: optionalText(60),
  email: z.union([z.string().trim().email('Must be a valid email address.'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optionalText(8000),
  source: optionalText(240),
  ownerEntityId: uuid.nullish(),
});

export const contactUpdateSchema = contactCreateSchema.partial().extend({
  version: z.number().int().positive(),
  markVerified: z.boolean().optional(),
});

export const ownerEntityCreateSchema = z.object({
  name: trimmed(240).min(1, 'Entity name is required.'),
  entityType: optionalText(60),
  mailingAddress: optionalText(400),
  notes: optionalText(4000),
  source: optionalText(240),
});

export const propertyContactLinkSchema = z.object({
  contactId: uuid,
  relationship: contactRole.default('other'),
  isPrimary: z.boolean().default(false),
  notes: optionalText(2000),
});

/** Attaches a contact to a property - an existing one by id, or a new one inline. */
export const propertyContactAttachSchema = z.object({
  contactId: uuid.optional(),
  newContact: contactCreateSchema.omit({ ownerEntityId: true }).optional(),
  relationship: contactRole.default('other'),
  isPrimary: z.boolean().default(false),
  notes: optionalText(2000),
}).refine((v) => Boolean(v.contactId ?? v.newContact), {
  message: 'Provide either an existing contact or details for a new one.',
});

export const propertyContactLinkUpdateSchema = z.object({
  relationship: contactRole.optional(),
  isPrimary: z.boolean().optional(),
  notes: optionalText(2000),
});

/* -------------------------------------------------------------------------- */
/* Activities and calls                                                       */
/* -------------------------------------------------------------------------- */

export const activityCreateSchema = z.object({
  propertyId: uuid,
  type: z.enum(['call', 'note', 'email', 'meeting']).default('call'),
  occurredAt: z.string().datetime().optional(),
  contactId: uuid.nullish(),
  contactNameFreeText: optionalText(200),
  outcome: z.enum([
    'no_answer', 'voicemail_left', 'wrong_number', 'spoke_with_broker', 'spoke_with_owner',
    'not_interested', 'may_sell_later', 'interested_in_selling', 'requested_information',
  ]).nullish(),
  subject: optionalText(240),
  notes: optionalText(20000),
  sellerMotivation: optionalText(4000),
  pricingExpectation: optionalText(4000),
  timingNotes: optionalText(4000),
  priceMentioned: optionalDecimal({ min: 0 }),
  followUpDate: optionalDate,
  /** Optional side-effects applied atomically with the log entry. */
  setOutreachStatusId: uuid.nullish(),
  setNextFollowUpDate: optionalDate,
});

export const activityUpdateSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  contactId: uuid.nullish(),
  contactNameFreeText: optionalText(200),
  outcome: activityCreateSchema.shape.outcome,
  subject: optionalText(240),
  notes: optionalText(20000),
  sellerMotivation: optionalText(4000),
  pricingExpectation: optionalText(4000),
  timingNotes: optionalText(4000),
  priceMentioned: optionalDecimal({ min: 0 }),
});

/* -------------------------------------------------------------------------- */
/* Opportunities                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Promotion is always explicit and always carries a reason. There is no code path
 * that creates an opportunity as a side effect of logging a call or setting a
 * follow-up.
 */
export const promoteToOpportunitySchema = z.object({
  propertyId: uuid,
  name: trimmed(240).optional(),
  stageId: uuid.optional(),
  promotionReason: trimmed(2000).min(10, 'Please describe why this is a real opportunity (at least 10 characters).'),
  targetPrice: optionalDecimal({ min: 0 }),
  nextStep: optionalText(1000),
  nextStepDate: optionalDate,
});

export const opportunityUpdateSchema = z.object({
  name: trimmed(240).optional(),
  stageId: uuid.optional(),
  stageChangeNote: optionalText(2000),
  targetPrice: optionalDecimal({ min: 0 }),
  offerPrice: optionalDecimal({ min: 0 }),
  contractPrice: optionalDecimal({ min: 0 }),
  expectedCloseDate: optionalDate,
  nextStep: optionalText(1000),
  nextStepDate: optionalDate,
  notes: optionalText(20000),
  version: z.number().int().positive(),
});

export const opportunityStateSchema = z.object({
  state: z.enum(['active', 'removed']),
  reason: optionalText(1000),
  version: z.number().int().positive(),
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const statusUpsertSchema = z.object({
  id: uuid.optional(),
  label: trimmed(80).min(1, 'Label is required.'),
  color: hexColor,
  sortOrder: z.number().int().min(0).max(9999),
  countsAsActivePursuit: z.boolean().optional(),
});

export const stageUpsertSchema = z.object({
  id: uuid.optional(),
  label: trimmed(80).min(1, 'Label is required.'),
  color: hexColor,
  sortOrder: z.number().int().min(0).max(9999),
  isTerminal: z.boolean().optional(),
  category: z.enum(['open', 'closed_won', 'closed_lost', 'on_hold']).optional(),
});

/** Archiving a status in use requires naming its replacement. */
export const statusArchiveSchema = z.object({
  reassignToId: uuid.nullish(),
});

export const customFieldDefSchema = z.object({
  label: trimmed(80).min(1, 'Label is required.'),
  type: z.enum(['text', 'number', 'date', 'checkbox', 'select']),
  options: z.array(trimmed(80).min(1)).max(50).optional(),
  helpText: optionalText(400),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).refine((v) => v.type !== 'select' || (v.options && v.options.length > 0), {
  message: 'A select field needs at least one option.',
  path: ['options'],
});

export const userCreateSchema = z.object({
  email: z.string().trim().email('Must be a valid email address.').max(240),
  name: trimmed(160).min(1, 'Name is required.'),
  role: z.enum(['admin', 'member']).default('member'),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(200),
});

export const userUpdateSchema = z.object({
  name: trimmed(160).min(1).optional(),
  role: z.enum(['admin', 'member']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(200).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(12, 'New password must be at least 12 characters.').max(200),
});
