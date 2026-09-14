import Link from 'next/link';
import { asc, isNull } from 'drizzle-orm';
import { ArrowLeft, Users as UsersIcon } from 'lucide-react';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requirePageAdmin } from '@/lib/auth/guards';
import { formatDateTime } from '@/lib/format';
import { StatusChip, Value } from '@/components/ui/primitives';
import { UserAdmin } from './user-admin';

export const metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const actor = await requirePageAdmin('/settings/users');

  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email, role: users.role,
      isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      hasPassword: users.passwordHash,
    })
    .from(users)
    .where(isNull(users.archivedAt))
    .orderBy(asc(users.name));

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/settings" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Settings
          </Link>
        </div>
        <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-900">
          <UsersIcon size={16} /> Users
        </h1>
        <p className="text-xs text-ink-500">
          Members research, edit records, log calls and manage opportunities. Admins additionally
          manage users, settings, imports and destructive actions.
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[900px] space-y-5">
          <UserAdmin currentUserId={actor.id} />

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Accounts</h2>
              <span className="text-[11px] text-ink-500">{rows.length}</span>
            </div>
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="w-56">Email</th>
                  <th className="w-24">Role</th>
                  <th className="w-28">Status</th>
                  <th className="w-40">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="cursor-default">
                    <td className="font-medium text-ink-900">
                      {u.name}
                      {u.id === actor.id && <span className="ml-1.5 text-[11px] text-ink-400">(you)</span>}
                    </td>
                    <td className="text-xs text-ink-600">{u.email}</td>
                    <td>
                      <StatusChip
                        label={u.role === 'admin' ? 'Admin' : 'Member'}
                        color={u.role === 'admin' ? '#2563eb' : '#64748b'}
                      />
                    </td>
                    <td className="text-xs">
                      {!u.isActive ? (
                        <span className="text-red-700">Disabled</span>
                      ) : !u.hasPassword ? (
                        <span className="text-amber-700">No password set</span>
                      ) : (
                        <span className="text-green-700">Active</span>
                      )}
                    </td>
                    <td className="text-xs text-ink-600">
                      <Value>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : null}</Value>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-ink-100 px-4 py-3">
              <p className="text-[11px] leading-relaxed text-ink-500">
                Users are never hard-deleted. Disabling an account blocks sign-in while keeping the
                person&rsquo;s name on every call note and audit entry they authored.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
