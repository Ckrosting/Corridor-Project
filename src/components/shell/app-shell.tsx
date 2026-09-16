'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Building2, CalendarClock, Inbox, LayoutDashboard, LogOut, Map, Settings,
  TrendingUp, Users,
} from 'lucide-react';
import { cn } from '@/components/ui/primitives';

export interface NavCounts {
  followUpsDue: number;
  discoveryPending: number;
  pipelineActive: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  badge?: keyof NavCounts;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/markets', label: 'Markets', icon: Map },
  { href: '/properties', label: 'Properties', icon: Building2 },
  { href: '/follow-ups', label: 'Follow-ups', icon: CalendarClock, badge: 'followUpsDue' },
  { href: '/pipeline', label: 'Pipeline', icon: TrendingUp, badge: 'pipelineActive' },
  { href: '/discovery', label: 'Discovery Inbox', icon: Inbox, badge: 'discoveryPending' },
  { href: '/contacts', label: 'Contacts', icon: Users },
];

export function AppShell({
  children, user, counts,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: 'admin' | 'member' };
  counts: NavCounts;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-200 bg-white">
        <div className="border-b border-ink-200 px-4 py-3">
          <Link href="/" className="block">
            <div className="text-sm font-semibold tracking-tight text-ink-900">Hull Corridor</div>
            <div className="text-[11px] text-ink-500">Hull Property Group</div>
          </Link>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto p-2">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badgeValue = item.badge ? counts[item.badge] : 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent-50 font-medium text-accent-700'
                    : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                )}
              >
                <item.icon size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{item.label}</span>
                {badgeValue > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[10px] font-semibold tnum',
                      active ? 'bg-accent-600 text-white' : 'bg-ink-200 text-ink-700',
                    )}
                  >
                    {badgeValue > 99 ? '99+' : badgeValue}
                  </span>
                )}
              </Link>
            );
          })}

          <div className="my-2 border-t border-ink-200" />

          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              pathname.startsWith('/settings')
                ? 'bg-accent-50 font-medium text-accent-700'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            <Settings size={16} aria-hidden="true" />
            Settings
          </Link>
        </nav>

        <div className="border-t border-ink-200 p-2">
          <div className="px-2.5 py-1.5">
            <div className="truncate text-xs font-medium text-ink-800">{user.name}</div>
            <div className="truncate text-[11px] text-ink-500">
              {user.email}
              {user.role === 'admin' && <span className="ml-1 text-accent-600">· Admin</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: '/signin' })}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ink-100">{children}</main>
    </div>
  );
}
