import {
  AGING_BUCKETS,
  AGING_LABELS,
  type AgingBucket,
  agingBucketFor,
  type OutstandingItem,
  type OutstandingItemsQuery,
  type OutstandingItemsResponse,
  type OutstandingQuery,
  type OutstandingResponse,
  type RevenueGrouping,
  type RevenueResponse,
  type RevenueValues,
} from '@emis/contracts';
import {
  afterCursor,
  branches,
  cohorts,
  courses,
  decodeCursor,
  departments,
  installments,
  invoices,
  payments,
  programs,
  students,
  toPage,
} from '@emis/db';
import { type Grant, scopesFor } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, ne, or, type SQL, sql } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { InstitutionService } from '../../settings/index.js';
import { decimalMoney, toCsv } from '../domain/csv.js';
import { bucketDueRange, resolveRange } from '../domain/range.js';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};
const CSV_ROW_LIMIT = 50_000;

export interface CsvFile {
  filename: string;
  content: string;
}

/**
 * Finance reports over what was actually recorded: payments received (voided ones excluded and
 * shown separately) and instalments still unpaid. Everything is computed by the database from
 * the same rows the invoices use, so a report can't drift from the invoices. Callers are limited to
 * the branches and departments their grant covers.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly institution: InstitutionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /** What the caller's grant lets them see, as a WHERE clause (none for an institution-wide grant). */
  private scope(
    grants: readonly Grant[],
    branchColumn: typeof invoices.branchId | typeof payments.branchId,
  ): SQL | undefined {
    const reach = scopesFor(grants, 'reports.finance');
    if (reach.all) return undefined;
    const parts = [
      reach.branchIds.length > 0 ? inArray(branchColumn, reach.branchIds) : undefined,
      reach.departmentIds.length > 0
        ? inArray(programs.departmentId, reach.departmentIds)
        : undefined,
    ].filter((p): p is SQL => p !== undefined);
    return parts.length > 0 ? or(...parts) : sql`false`;
  }

  // --- revenue -------------------------------------------------------------------------------

  async revenue(query: RevenueValues, grants: readonly Grant[]): Promise<RevenueResponse> {
    const inst = await this.institution.get();
    const { from, to } = resolveRange(query, await this.institution.today());
    const tz = inst.timezone;
    const start = sql`(${from}::date)::timestamp AT TIME ZONE ${tz}`;
    const end = sql`((${to}::date + 1))::timestamp AT TIME ZONE ${tz}`;

    const keyLabel = this.grouping(query.groupBy, tz);
    const base = (status: 'posted' | 'void') =>
      this.db
        .select({
          key: keyLabel.key,
          label: keyLabel.label,
          count: sql<string>`count(*)`,
          amount: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .innerJoin(branches, eq(branches.id, payments.branchId))
        .leftJoin(cohorts, eq(cohorts.id, invoices.cohortId))
        .leftJoin(courses, eq(courses.id, cohorts.courseId))
        .leftJoin(programs, eq(programs.id, courses.programId))
        .leftJoin(departments, eq(departments.id, programs.departmentId))
        .where(
          and(
            eq(payments.status, status),
            sql`${payments.receivedAt} >= ${start}`,
            sql`${payments.receivedAt} < ${end}`,
            query.branchId ? eq(payments.branchId, query.branchId) : undefined,
            query.departmentId ? eq(programs.departmentId, query.departmentId) : undefined,
            query.method ? eq(payments.method, query.method) : undefined,
            this.scope(grants, payments.branchId),
          ),
        );

    // Sequential, not Promise.all: these share the caller's transaction connection.
    const posted = await base('posted')
      .groupBy(sql`1`, sql`2`)
      .orderBy(query.groupBy === 'day' || query.groupBy === 'month' ? asc(sql`1`) : sql`4 desc, 2`);
    const voidedRows = await base('void').groupBy(sql`1`, sql`2`);

    const rows = posted.map((r) => ({
      key: r.key,
      label: query.groupBy === 'method' ? (METHOD_LABELS[r.key] ?? r.key) : r.label,
      count: Number(r.count),
      amount: Number(r.amount),
    }));
    return {
      from,
      to,
      groupBy: query.groupBy,
      currency: inst.currency,
      rows,
      totals: {
        count: rows.reduce((n, r) => n + r.count, 0),
        amount: rows.reduce((n, r) => n + r.amount, 0),
        voidedCount: voidedRows.reduce((n, r) => n + Number(r.count), 0),
        voidedAmount: voidedRows.reduce((n, r) => n + Number(r.amount), 0),
      },
    };
  }

  private grouping(by: RevenueGrouping, tz: string): { key: SQL<string>; label: SQL<string> } {
    switch (by) {
      case 'day':
        return {
          key: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
          label: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
        };
      case 'month':
        return {
          key: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE ${tz}, 'YYYY-MM')`,
          label: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE ${tz}, 'YYYY-MM')`,
        };
      case 'branch':
        return { key: sql<string>`${branches.id}::text`, label: sql<string>`${branches.name}` };
      case 'department':
        return {
          key: sql<string>`coalesce(${departments.id}::text, 'none')`,
          label: sql<string>`coalesce(${departments.name}, 'No class')`,
        };
      case 'program':
        return {
          key: sql<string>`coalesce(${programs.id}::text, 'none')`,
          label: sql<string>`coalesce(${programs.name}, 'No class')`,
        };
      case 'method':
        return { key: sql<string>`${payments.method}`, label: sql<string>`${payments.method}` };
    }
  }

  // --- outstanding balances ------------------------------------------------------------------

  /** Instalments with something left to pay on an invoice that isn't void. */
  private owedConditions(query: OutstandingQuery, grants: readonly Grant[]) {
    return and(
      ne(invoices.status, 'void'),
      sql`${installments.amount} > ${installments.paidAmount}`,
      query.branchId ? eq(invoices.branchId, query.branchId) : undefined,
      query.departmentId ? eq(programs.departmentId, query.departmentId) : undefined,
      this.scope(grants, invoices.branchId),
    );
  }

  async outstanding(
    query: OutstandingQuery,
    grants: readonly Grant[],
  ): Promise<OutstandingResponse> {
    const inst = await this.institution.get();
    const asOf = query.asOf ?? (await this.institution.today());
    const days = sql`(${asOf}::date - ${installments.dueDate})`;
    const bucketExpr = sql<AgingBucket>`case
      when ${days} <= 0 then 'not_due'
      when ${days} <= 30 then 'd1_30'
      when ${days} <= 60 then 'd31_60'
      when ${days} <= 90 then 'd61_90'
      else 'd90_plus' end`;
    const rows = await this.db
      .select({
        bucket: bucketExpr,
        count: sql<string>`count(*)`,
        amount: sql<string>`coalesce(sum(${installments.amount} - ${installments.paidAmount}), 0)`,
      })
      .from(installments)
      .innerJoin(invoices, eq(invoices.id, installments.invoiceId))
      .leftJoin(cohorts, eq(cohorts.id, invoices.cohortId))
      .leftJoin(courses, eq(courses.id, cohorts.courseId))
      .leftJoin(programs, eq(programs.id, courses.programId))
      .where(this.owedConditions(query, grants))
      .groupBy(sql`1`);

    const buckets = AGING_BUCKETS.map((bucket) => {
      const row = rows.find((r) => r.bucket === bucket);
      return {
        bucket,
        label: AGING_LABELS[bucket],
        count: Number(row?.count ?? 0),
        amount: Number(row?.amount ?? 0),
      };
    });
    const overdue = buckets.filter((b) => b.bucket !== 'not_due');
    return {
      asOf,
      currency: inst.currency,
      buckets,
      totals: {
        count: buckets.reduce((n, b) => n + b.count, 0),
        amount: buckets.reduce((n, b) => n + b.amount, 0),
        overdueCount: overdue.reduce((n, b) => n + b.count, 0),
        overdueAmount: overdue.reduce((n, b) => n + b.amount, 0),
      },
    };
  }

  async outstandingItems(
    query: OutstandingItemsQuery,
    grants: readonly Grant[],
  ): Promise<OutstandingItemsResponse> {
    const asOf = query.asOf ?? (await this.institution.today());
    const range = query.bucket ? bucketDueRange(query.bucket, asOf) : {};
    const conditions: (SQL | undefined)[] = [
      this.owedConditions(query, grants),
      range.min ? gte(installments.dueDate, range.min) : undefined,
      range.max ? lte(installments.dueDate, range.max) : undefined,
    ];
    if (query.cursor) {
      const [dueDate, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([installments.dueDate, installments.id], [String(dueDate), String(id)], 'asc'),
      );
    }
    const rows = await this.db
      .select({
        installmentId: installments.id,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
        studentId: students.id,
        studentNumber: students.studentNumber,
        givenName: students.givenName,
        fatherName: students.fatherName,
        branchId: invoices.branchId,
        sequence: installments.sequence,
        dueDate: installments.dueDate,
        owed: sql<string>`${installments.amount} - ${installments.paidAmount}`,
      })
      .from(installments)
      .innerJoin(invoices, eq(invoices.id, installments.invoiceId))
      .innerJoin(students, eq(students.id, invoices.studentId))
      .leftJoin(cohorts, eq(cohorts.id, invoices.cohortId))
      .leftJoin(courses, eq(courses.id, cohorts.courseId))
      .leftJoin(programs, eq(programs.id, courses.programId))
      .where(and(...conditions))
      .orderBy(asc(installments.dueDate), asc(installments.id))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (r) => [r.dueDate, r.installmentId]);
    return {
      items: page.items.map((r) => this.toItem(r, asOf)),
      nextCursor: page.nextCursor,
    };
  }

  private toItem(
    r: {
      installmentId: string;
      invoiceId: string;
      invoiceNumber: string;
      studentId: string;
      studentNumber: string;
      givenName: string;
      fatherName: string;
      branchId: string;
      sequence: number;
      dueDate: string;
      owed: string;
    },
    asOf: string,
  ): OutstandingItem {
    const daysOverdue = Math.round(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${r.dueDate}T00:00:00Z`)) / 86_400_000,
    );
    return {
      installmentId: r.installmentId,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      studentId: r.studentId,
      studentNumber: r.studentNumber,
      studentName: `${r.givenName} ${r.fatherName}`,
      branchId: r.branchId,
      sequence: r.sequence,
      dueDate: r.dueDate,
      owed: Number(r.owed),
      daysOverdue,
      bucket: agingBucketFor(daysOverdue),
    };
  }

  // --- CSV -----------------------------------------------------------------------------------

  async revenueCsv(query: RevenueValues, grants: readonly Grant[]): Promise<CsvFile> {
    const report = await this.revenue(query, grants);
    const content = toCsv(
      [REVENUE_HEADINGS[report.groupBy], 'Payments', `Amount (${report.currency})`],
      [
        ...report.rows.map((r) => [r.label, r.count, { numeric: decimalMoney(r.amount) }]),
        ['Total', report.totals.count, { numeric: decimalMoney(report.totals.amount) }],
      ],
    );
    await this.audit.record({
      action: 'report.exported',
      entityType: 'report',
      changes: {
        report: 'revenue',
        from: report.from,
        to: report.to,
        groupBy: report.groupBy,
        rows: report.rows.length,
      },
    });
    return { filename: `revenue-${report.from}-to-${report.to}.csv`, content };
  }

  async outstandingCsv(query: OutstandingQuery, grants: readonly Grant[]): Promise<CsvFile> {
    const inst = await this.institution.get();
    const asOf = query.asOf ?? (await this.institution.today());
    const items: OutstandingItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.outstandingItems({ ...query, asOf, limit: 100, cursor }, grants);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length < CSV_ROW_LIMIT);

    const content = toCsv(
      [
        'Student number',
        'Student',
        'Invoice',
        'Instalment',
        'Due date',
        'Days overdue',
        'Age',
        `Owed (${inst.currency})`,
      ],
      items.map((i) => [
        i.studentNumber,
        i.studentName,
        i.invoiceNumber,
        i.sequence,
        i.dueDate,
        Math.max(i.daysOverdue, 0),
        AGING_LABELS[i.bucket],
        { numeric: decimalMoney(i.owed) },
      ]),
    );
    await this.audit.record({
      action: 'report.exported',
      entityType: 'report',
      changes: { report: 'outstanding', asOf, rows: items.length },
    });
    return { filename: `outstanding-as-of-${asOf}.csv`, content };
  }
}

const REVENUE_HEADINGS: Record<RevenueGrouping, string> = {
  day: 'Date',
  month: 'Month',
  branch: 'Branch',
  department: 'Department',
  program: 'Program',
  method: 'Method',
};
