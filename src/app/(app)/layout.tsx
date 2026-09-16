import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { discoveryResults, opportunities, transactionStages } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { getFollowUpCounts } from '@/lib/services/activities';
import { AppShell } from '@/components/shell/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageUser();

  const [followUps, pending, activeOpps] = await Promise.all([
    getFollowUpCounts(),
    db.select({ id: discoveryResults.id }).from(discoveryResults).where(eq(discoveryResults.status, 'new')),
    db.select({ id: opportunities.id })
      .from(opportunities)
      .leftJoin(transactionStages, eq(transactionStages.id, opportunities.stageId))
      .where(and(
        eq(opportunities.state, 'active'),
        isNull(opportunities.archivedAt),
        eq(transactionStages.isTerminal, false),
        // Badges reflect real, actionable work regardless of whether sample
        // data is currently being shown elsewhere - see getFollowUps' same rule.
        eq(opportunities.isSample, false),
      )),
  ]);

  return (
    <AppShell
      user={{ name: actor.name, email: actor.email, role: actor.role }}
      counts={{
        followUpsDue: followUps.overdue + followUps.today,
        discoveryPending: pending.length,
        pipelineActive: activeOpps.length,
      }}
    >
      {children}
    </AppShell>
  );
}
