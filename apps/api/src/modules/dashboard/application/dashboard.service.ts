import { type Dashboard, OPEN_STATUSES } from '@emis/contracts';
import {
  applications,
  approvalRequests,
  cohorts,
  courses,
  departments,
  enrollments,
  installments,
  invoices,
  payments,
  programs,
  rooms,
  shifts,
  students,
} from '@emis/db';
import { type Grant, hasPermission, type Permission } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, ne, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { addDays } from '../../../common/dates.js';
import { branchReach } from '../../../common/authz/scope.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AccessService } from '../../access/index.js';
import { CohortsService } from '../../cohorts/index.js';
import { ReportsService } from '../../reports/index.js';
import { InstitutionService } from '../../settings/index.js';
import { firstOfMonth, previousMonth } from '../domain/months.js';

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';
const SOON_DAYS = 14;

/**
 * The portal home: a handful of numbers per area, each shown only if the caller holds the
 * permission for it and limited to the branches that permission reaches. Every figure is counted
 * by the database when asked, so the home page can't disagree with the screens it links to.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly access: AccessService,
    private readonly institution: InstitutionService,
    private readonly cohortsService: CohortsService,
    private readonly reports: ReportsService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  private branchFilter(
    grants: readonly Grant[],
    permission: Permission,
    column: PgColumn,
  ): SQL | undefined {
    const reach = branchReach(grants, permission);
    return reach === 'all' ? undefined : inArray(column, reach.length > 0 ? reach : [NO_BRANCH]);
  }

  async forUser(userId: string): Promise<Dashboard> {
    const grants = await this.access.grantsFor(userId);
    const inst = await this.institution.get();
    const today = await this.institution.today();
    const can = (permission: Permission) => hasPermission(grants, permission);

    const dashboard: Dashboard = { today, currency: inst.currency };
    // Sequential, not Promise.all: these share the caller's transaction connection.
    if (can('admissions.read')) dashboard.admissions = await this.admissions(grants);
    if (can('students.read')) dashboard.students = await this.studentCount(grants);
    if (can('cohorts.read')) dashboard.classes = await this.classes(grants, today);
    if (can('enrollments.read')) {
      dashboard.enrollmentsByDepartment = await this.enrollmentsByDepartment(grants);
    }
    if (can('reports.finance')) dashboard.finance = await this.finance(grants, today);
    if (can('billing.read')) dashboard.desk = await this.desk(grants, today, inst.timezone);
    if (can('approvals.decide')) dashboard.approvals = await this.approvals(userId);
    return dashboard;
  }

  private async admissions(
    grants: readonly Grant[],
  ): Promise<NonNullable<Dashboard['admissions']>> {
    const scope = this.branchFilter(grants, 'admissions.read', applications.branchId);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [row] = await this.db
      .select({
        newCount: sql<string>`count(*) filter (where ${applications.status} = 'submitted')`,
        openCount: sql<string>`count(*) filter (where ${inArray(applications.status, [...OPEN_STATUSES])})`,
        last7Days: sql<string>`count(*) filter (where ${gte(applications.createdAt, since)})`,
      })
      .from(applications)
      .where(scope);
    return {
      newCount: Number(row?.newCount ?? 0),
      openCount: Number(row?.openCount ?? 0),
      last7Days: Number(row?.last7Days ?? 0),
    };
  }

  private async studentCount(grants: readonly Grant[]): Promise<{ active: number }> {
    const [row] = await this.db
      .select({ n: count() })
      .from(students)
      .where(
        and(
          eq(students.status, 'active'),
          this.branchFilter(grants, 'students.read', students.branchId),
        ),
      );
    return { active: row?.n ?? 0 };
  }

  private async classes(
    grants: readonly Grant[],
    today: string,
  ): Promise<NonNullable<Dashboard['classes']>> {
    const scope = this.branchFilter(grants, 'cohorts.read', cohorts.branchId);
    const byStatus = await this.db
      .select({ status: cohorts.status, n: count() })
      .from(cohorts)
      .where(scope)
      .groupBy(cohorts.status);
    const statusCount = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;

    const [waiting] = await this.db
      .select({ n: count() })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .where(and(eq(enrollments.status, 'waitlisted'), scope));

    const live = inArray(cohorts.status, ['open', 'running']);
    const seats = await this.db
      .select({
        shiftId: shifts.id,
        shiftName: shifts.name,
        capacity: sql<string>`sum(least(${cohorts.maxSize}, ${rooms.capacity}))`,
      })
      .from(cohorts)
      .innerJoin(rooms, eq(rooms.id, cohorts.roomId))
      .innerJoin(shifts, eq(shifts.id, cohorts.shiftId))
      .where(and(live, scope))
      .groupBy(shifts.id, shifts.name)
      .orderBy(asc(shifts.name));
    const filled = await this.db
      .select({ shiftId: cohorts.shiftId, n: count() })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .where(and(eq(enrollments.status, 'active'), live, scope))
      .groupBy(cohorts.shiftId);

    const reach = branchReach(grants, 'cohorts.read');
    const soon = (await this.cohortsService.listJoinable({ today }))
      .filter(
        (c) =>
          c.startDate >= today &&
          c.startDate <= addDays(today, SOON_DAYS) &&
          (reach === 'all' || reach.includes(c.branchId)),
      )
      .slice(0, 5);

    return {
      open: statusCount('open'),
      running: statusCount('running'),
      waitlisted: waiting?.n ?? 0,
      occupancy: seats.map((s) => ({
        shiftId: s.shiftId,
        shiftName: s.shiftName,
        capacity: Number(s.capacity),
        enrolled: filled.find((f) => f.shiftId === s.shiftId)?.n ?? 0,
      })),
      startingSoon: soon.map((c) => ({
        id: c.id,
        name: c.name,
        startDate: c.startDate,
        capacity: c.capacity,
        enrolled: c.enrolledCount,
        seatsLeft: c.seatsLeft,
      })),
    };
  }

  private async enrollmentsByDepartment(
    grants: readonly Grant[],
  ): Promise<NonNullable<Dashboard['enrollmentsByDepartment']>> {
    const rows = await this.db
      .select({
        departmentId: departments.id,
        name: sql<string>`coalesce(${departments.name}, 'No department')`,
        active: count(),
      })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .leftJoin(courses, eq(courses.id, cohorts.courseId))
      .leftJoin(programs, eq(programs.id, courses.programId))
      .leftJoin(departments, eq(departments.id, programs.departmentId))
      .where(
        and(
          eq(enrollments.status, 'active'),
          this.branchFilter(grants, 'enrollments.read', cohorts.branchId),
        ),
      )
      .groupBy(departments.id, departments.name)
      .orderBy(sql`3 desc`, asc(departments.name));
    return rows;
  }

  private async finance(
    grants: readonly Grant[],
    today: string,
  ): Promise<NonNullable<Dashboard['finance']>> {
    const base = { groupBy: 'day' as const };
    const thisMonth = await this.reports.revenue(
      { ...base, from: firstOfMonth(today), to: today },
      grants,
    );
    const lastMonth = await this.reports.revenue({ ...base, ...previousMonth(today) }, grants);
    const owed = await this.reports.outstanding({ asOf: today }, grants);
    return {
      collectedThisMonth: thisMonth.totals.amount,
      collectedLastMonth: lastMonth.totals.amount,
      outstanding: owed.totals.amount,
      overdue: owed.totals.overdueAmount,
      overdueCount: owed.totals.overdueCount,
    };
  }

  private async desk(
    grants: readonly Grant[],
    today: string,
    timezone: string,
  ): Promise<NonNullable<Dashboard['desk']>> {
    const start = sql`(${today}::date)::timestamp AT TIME ZONE ${timezone}`;
    const end = sql`((${today}::date + 1))::timestamp AT TIME ZONE ${timezone}`;
    const [paid] = await this.db
      .select({
        n: sql<string>`count(*)`,
        amount: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'posted'),
          sql`${payments.receivedAt} >= ${start}`,
          sql`${payments.receivedAt} < ${end}`,
          this.branchFilter(grants, 'billing.read', payments.branchId),
        ),
      );

    const [owed] = await this.db
      .select({
        dueToday: sql<string>`count(*) filter (where ${installments.dueDate} = ${today})`,
        overdue: sql<string>`count(*) filter (where ${installments.dueDate} < ${today})`,
      })
      .from(installments)
      .innerJoin(invoices, eq(invoices.id, installments.invoiceId))
      .where(
        and(
          ne(invoices.status, 'void'),
          sql`${installments.amount} > ${installments.paidAmount}`,
          this.branchFilter(grants, 'billing.read', invoices.branchId),
        ),
      );
    return {
      collectedToday: Number(paid?.amount ?? 0),
      paymentsToday: Number(paid?.n ?? 0),
      dueToday: Number(owed?.dueToday ?? 0),
      overdueCount: Number(owed?.overdue ?? 0),
    };
  }

  /** Requests waiting for a decision that this person could make (never their own). */
  private async approvals(userId: string): Promise<{ pending: number }> {
    const [row] = await this.db
      .select({ n: count() })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.status, 'pending'), ne(approvalRequests.requestedBy, userId)));
    return { pending: row?.n ?? 0 };
  }
}
