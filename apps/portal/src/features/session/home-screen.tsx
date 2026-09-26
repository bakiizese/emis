'use client';

import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import Link from 'next/link';

import { useMoney } from '@/features/billing/money';
import {
  daysUntil,
  monthComparison,
  occupancyPercent,
  startsIn,
} from '@/features/dashboard/figures';
import { Bar, Stat } from '@/features/dashboard/stat';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import { useInstitution } from '@/features/institution/use-institution';
import { barPercent } from '@/features/reports/query';
import { errorMessage } from '@/lib/api';

import { useSession } from './use-session';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function HomeScreen() {
  const { me, access } = useSession();
  const { term } = useInstitution();
  const { fmt } = useMoney();
  const dashboard = useDashboard();
  if (!me) return null;
  const d = dashboard.data;
  const noun = (key: Parameters<typeof term>[0]) => term(key, true);
  const nothingToShow =
    d && !d.admissions && !d.students && !d.classes && !d.finance && !d.desk && !d.approvals;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {me.user.displayName}</h1>
        {d ? <p className="text-muted-foreground text-sm">Figures for {d.today}</p> : null}
      </div>

      {dashboard.error ? <Alert tone="error">{errorMessage(dashboard.error)}</Alert> : null}

      {d?.approvals && d.approvals.pending > 0 ? (
        <Link href="/billing/approvals" className="block">
          <Alert tone="info" className="hover:border-primary">
            <strong>{d.approvals.pending}</strong> request{d.approvals.pending === 1 ? '' : 's'}{' '}
            waiting for your decision. Review them
          </Alert>
        </Link>
      ) : null}

      {d?.desk ? (
        <Section title="Today at the desk">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Collected today"
              value={fmt(d.desk.collectedToday)}
              hint={`${d.desk.paymentsToday} payment${d.desk.paymentsToday === 1 ? '' : 's'}`}
              href="/billing/invoices"
            />
            <Stat label="Instalments due today" value={d.desk.dueToday} href="/billing/invoices" />
            <Stat
              label="Overdue instalments"
              value={d.desk.overdueCount}
              tone={d.desk.overdueCount > 0 ? 'attention' : 'default'}
              href="/billing/invoices"
            />
          </div>
        </Section>
      ) : null}

      {d?.finance ? (
        <Section title="Money">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Collected this month"
              value={fmt(d.finance.collectedThisMonth)}
              hint={monthComparison(d.finance.collectedThisMonth, d.finance.collectedLastMonth)}
              href="/reports"
            />
            <Stat label="Still to collect" value={fmt(d.finance.outstanding)} href="/reports" />
            <Stat
              label="Overdue"
              value={fmt(d.finance.overdue)}
              hint={`${d.finance.overdueCount} instalment${d.finance.overdueCount === 1 ? '' : 's'}`}
              tone={d.finance.overdue > 0 ? 'attention' : 'default'}
              href="/reports"
            />
          </div>
        </Section>
      ) : null}

      {d?.admissions || d?.students || d?.classes ? (
        <Section title="People and classes">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.admissions ? (
              <>
                <Stat
                  label="New applications"
                  value={d.admissions.newCount}
                  hint={`${d.admissions.last7Days} in the last 7 days`}
                  tone={d.admissions.newCount > 0 ? 'attention' : 'default'}
                  href="/admissions"
                />
                <Stat
                  label="In the admissions pipeline"
                  value={d.admissions.openCount}
                  href="/admissions"
                />
              </>
            ) : null}
            {d.students ? (
              <Stat
                label={`Active ${noun('student').toLowerCase()}`}
                value={d.students.active}
                href="/students"
              />
            ) : null}
            {d.classes ? (
              <>
                <Stat
                  label={`Open ${noun('cohort').toLowerCase()}`}
                  value={d.classes.open}
                  hint={`${d.classes.running} running`}
                  href="/cohorts"
                />
                <Stat label="On waiting lists" value={d.classes.waitlisted} href="/cohorts" />
              </>
            ) : null}
          </div>
        </Section>
      ) : null}

      {d?.classes && d.classes.occupancy.length > 0 ? (
        <Section title={`Seats by ${term('shift').toLowerCase()}`}>
          <Card className="space-y-4">
            {d.classes.occupancy.map((row) => {
              const percent = occupancyPercent(row.enrolled, row.capacity);
              return (
                <div key={row.shiftId} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{row.shiftName}</span>
                    <span className="text-muted-foreground">
                      {row.enrolled} of {row.capacity} seats · {percent}%
                    </span>
                  </div>
                  <Bar percent={percent} />
                </div>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {d?.classes && d.classes.startingSoon.length > 0 ? (
        <Section title={`${noun('cohort')} starting soon`}>
          <ul className="border-border divide-border divide-y rounded-xl border">
            {d.classes.startingSoon.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <Link href={`/cohorts/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <span className="text-muted-foreground">
                  {startsIn(daysUntil(c.startDate, d.today))} · {c.enrolled} of {c.capacity} seats
                  filled
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {d?.enrollmentsByDepartment && d.enrollmentsByDepartment.length > 0 ? (
        <Section
          title={`Enrolled ${noun('student').toLowerCase()} by ${term('department').toLowerCase()}`}
        >
          <Card className="space-y-4">
            {d.enrollmentsByDepartment.map((row) => {
              const max = Math.max(...d.enrollmentsByDepartment!.map((r) => r.active));
              return (
                <div key={row.departmentId ?? 'none'} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground">{row.active}</span>
                  </div>
                  <Bar percent={barPercent(row.active, max)} />
                </div>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {nothingToShow ? (
        <Alert>
          There is nothing to summarise for your role yet. Ask an admin if you should have access to
          more.
        </Alert>
      ) : null}

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Your account</CardTitle>
          <CardDescription>{me.user.email}</CardDescription>
        </CardHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {access?.roles.length
              ? access.roles.map((r) => (
                  <Badge key={r.key} tone="info">
                    {r.name}
                  </Badge>
                ))
              : 'None yet'}
          </dd>
          <dt className="text-muted-foreground">Two-factor</dt>
          <dd>{me.user.mfaEnabled ? 'On' : 'Off'}</dd>
        </dl>
      </Card>
    </div>
  );
}
