import { asc, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { userCreateSchema } from '@/lib/validation/schemas';
import { hashPassword } from '@/lib/auth/password';
import { recordAudit } from '@/lib/services/audit';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  await requireAdmin();
  // The password hash is never selected, so it cannot leak through a response.
  return ok({
    users: await db
      .select({
        id: users.id, name: users.name, email: users.email, role: users.role,
        isActive: users.isActive, lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(isNull(users.archivedAt))
      .orderBy(asc(users.name)),
  });
});

export const POST = route(async (req: Request) => {
  const actor = await requireAdmin();
  const input = userCreateSchema.parse(await readJson(req));

  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(raw`lower(${users.email}) = lower(${input.email})`)
    .limit(1);
  if (clash) throw new ValidationError('An account with that email address already exists.');

  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    })
    .returning({
      id: users.id, name: users.name, email: users.email,
      role: users.role, isActive: users.isActive,
    });

  await recordAudit({
    entityType: 'user', entityId: user!.id, action: 'create',
    summary: `Created ${input.role} account for ${input.email}`,
    actor,
  });

  return ok({ user }, 201);
});
