'use client';

import {
  type Guardian,
  personFieldsSchema,
  type Student,
  STUDENT_STATUSES,
  setGuardiansRequestSchema,
  studentSchema,
  studentStatusSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { useBranches } from '@/features/institution/use-org-units';
import { useInstitution } from '@/features/institution/use-institution';
import {
  CustomFieldInputs,
  type CustomValues,
  customFieldErrors,
} from '@/features/people/custom-field-inputs';
import { PersonFields, personToForm } from '@/features/people/person-fields';
import { StudentStatusBadge, studentStatusLabel } from '@/features/people/status-badges';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { formatDate } from '@/features/academics/use-catalog';
import { cohortStatusLabel } from '@/features/cohorts/cohorts-screen';
import { useStudentEnrollments } from '@/features/cohorts/use-cohorts';
import { useMoney } from '@/features/billing/money';
import { invoiceLabel, invoiceTone } from '@/features/billing/invoices-screen';
import { useStudentInvoices } from '@/features/billing/use-billing';
import { invoiceSchema } from '@emis/contracts';
import { useIdempotencyKey } from '@/lib/idempotency';
import { Badge } from '@emis/ui/components/badge';
import { useSession } from '@/features/session/use-session';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';

const detailsSchema = personFieldsSchema.extend({
  categoryCode: z.string(),
  status: studentStatusSchema,
});
type DetailsInput = z.input<typeof detailsSchema>;
type DetailsOutput = z.output<typeof detailsSchema>;

function DetailsForm({
  student,
  canEdit,
  onSaved,
}: {
  student: Student;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useDescriptorOptions('student_category');
  const [customValues, setCustomValues] = useState<CustomValues>(student.customFields);

  const form = useForm<DetailsInput, unknown, DetailsOutput>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      ...personToForm(student),
      categoryCode: student.categoryCode ?? '',
      status: student.status,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: DetailsOutput) =>
      apiRequest(`/students/${student.id}`, {
        method: 'PATCH',
        body: { ...values, categoryCode: values.categoryCode || null, customFields: customValues },
        schema: studentSchema,
        ifMatch: student.version,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['students', 'one', student.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      onSaved('Details saved.');
    },
  });
  const fieldErrors =
    save.error instanceof ApiError ? customFieldErrors(save.error.fieldErrors) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <FormProvider {...form}>
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        >
          <fieldset disabled={!canEdit} className="space-y-6">
            <PersonFields />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="Status"
                error={errors.status?.message}
                {...form.register('status')}
              >
                {STUDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {studentStatusLabel(s)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Category"
                error={errors.categoryCode?.message}
                {...form.register('categoryCode')}
              >
                <option value="">None</option>
                {/* Keep a since-retired category selectable so saving doesn't silently drop it. */}
                {student.categoryCode &&
                !categories.data?.some((c) => c.code === student.categoryCode) ? (
                  <option value={student.categoryCode}>{student.categoryCode}</option>
                ) : null}
                {categories.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <CustomFieldInputs
              entityType="student"
              values={customValues}
              onChange={setCustomValues}
              errors={fieldErrors}
            />
          </fieldset>
          {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : null}
        </form>
      </FormProvider>
    </Card>
  );
}

type GuardianRow = Omit<Guardian, 'id'>;
const blankGuardian = (): GuardianRow => ({
  name: '',
  relationship: '',
  phone: '',
  email: null,
  isPrimary: false,
  isPayer: false,
});

function GuardiansCard({
  student,
  canEdit,
  onSaved,
}: {
  student: Student;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<GuardianRow[]>(
    student.guardians.map(({ id: _id, ...rest }) => rest),
  );
  const [problem, setProblem] = useState<string | null>(null);

  /** Only one main contact and one payer: choosing one clears the others. */
  const set = (index: number, patch: Partial<GuardianRow>) => {
    setRows(
      rows.map((row, i) =>
        i === index
          ? { ...row, ...patch }
          : {
              ...row,
              isPrimary: patch.isPrimary ? false : row.isPrimary,
              isPayer: patch.isPayer ? false : row.isPayer,
            },
      ),
    );
  };

  const save = useMutation({
    mutationFn: (guardians: unknown) =>
      apiRequest(`/students/${student.id}/guardians`, {
        method: 'PUT',
        body: { guardians },
        schema: studentSchema,
        ifMatch: student.version,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['students', 'one', student.id], updated);
      onSaved('Contacts saved.');
    },
  });

  function submit() {
    setProblem(null);
    const parsed = setGuardiansRequestSchema.safeParse({
      guardians: rows.map((r) => ({ ...r, email: r.email ?? '' })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index = typeof issue?.path[1] === 'number' ? ` (contact ${issue.path[1] + 1})` : '';
      return setProblem(`${issue?.message ?? 'Check the contacts'}${index}`);
    }
    save.mutate(rows.map((r) => ({ ...r, email: r.email ?? '' })));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guardians and contacts</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No contacts yet.</p>
        ) : null}
        {rows.map((row, index) => (
          <div key={index} className="border-border space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                aria-label="Name"
                placeholder="Full name"
                value={row.name}
                disabled={!canEdit}
                onChange={(e) => set(index, { name: e.target.value })}
              />
              <Input
                aria-label="Relationship"
                placeholder="Relationship, e.g. Mother"
                value={row.relationship}
                disabled={!canEdit}
                onChange={(e) => set(index, { relationship: e.target.value })}
              />
              <Input
                aria-label="Phone"
                type="tel"
                placeholder="Phone"
                value={row.phone}
                disabled={!canEdit}
                onChange={(e) => set(index, { phone: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Input
                aria-label="Email"
                type="email"
                placeholder="Email (optional)"
                className="max-w-xs"
                value={row.email ?? ''}
                disabled={!canEdit}
                onChange={(e) => set(index, { email: e.target.value || null })}
              />
              <CheckboxField
                label="Main contact"
                checked={row.isPrimary}
                disabled={!canEdit}
                onChange={(e) => set(index, { isPrimary: e.target.checked })}
              />
              <CheckboxField
                label="Pays the fees"
                checked={row.isPayer}
                disabled={!canEdit}
                onChange={(e) => set(index, { isPayer: e.target.checked })}
              />
              {canEdit ? (
                <Button
                  variant="ghost"
                  className="ml-auto h-8 px-3"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {problem ? <Alert tone="error">{problem}</Alert> : null}
        {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        {canEdit ? (
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="secondary"
              disabled={rows.length >= 5}
              onClick={() => setRows([...rows, blankGuardian()])}
            >
              Add contact
            </Button>
            <Button disabled={save.isPending} onClick={submit}>
              {save.isPending ? 'Saving…' : 'Save contacts'}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Invoices for the student, and a button to bill any class they're in that hasn't been billed yet. */
function BillingCard({ studentId, canInvoice }: { studentId: string; canInvoice: boolean }) {
  const { fmt } = useMoney();
  const queryClient = useQueryClient();
  const invoices = useStudentInvoices(studentId, true);
  const enrollments = useStudentEnrollments(studentId, true);
  const idempotency = useIdempotencyKey();

  const billed = new Set(invoices.data?.items.map((i) => i.enrollmentId));
  const unbilled = (enrollments.data?.items ?? []).filter(
    (e) => (e.status === 'active' || e.status === 'completed') && !billed.has(e.id),
  );

  const create = useMutation({
    mutationFn: (enrollmentId: string) => {
      const body = { enrollmentId };
      return apiRequest('/invoices', {
        method: 'POST',
        body,
        schema: invoiceSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      idempotency.reset();
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fees</CardTitle>
      </CardHeader>
      {invoices.error ? <Alert tone="error">{errorMessage(invoices.error)}</Alert> : null}
      {create.error ? <Alert tone="error">{errorMessage(create.error)}</Alert> : null}
      {invoices.data && invoices.data.items.length === 0 && unbilled.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing billed yet.</p>
      ) : null}
      <ul className="divide-border divide-y">
        {invoices.data?.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div>
              <Link
                href={`/billing/invoices/${i.id}`}
                className="font-mono text-xs font-medium hover:underline"
              >
                {i.number}
              </Link>
              <div className="text-muted-foreground text-xs">
                {fmt(i.total)} ·{' '}
                {i.status === 'paid' || i.status === 'void'
                  ? invoiceLabel(i.status)
                  : `${fmt(i.balance)} to pay`}
              </div>
            </div>
            <Badge tone={invoiceTone[i.status]}>{invoiceLabel(i.status)}</Badge>
          </li>
        ))}
        {unbilled.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>{e.cohortName} has no invoice yet.</span>
            {canInvoice ? (
              <Button
                className="h-8 px-3"
                disabled={create.isPending}
                onClick={() => create.mutate(e.id)}
              >
                Create invoice
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ClassesCard({ studentId }: { studentId: string }) {
  const { term } = useInstitution();
  const enrollments = useStudentEnrollments(studentId, true);
  const items = enrollments.data?.items ?? [];
  const tone = {
    active: 'success',
    waitlisted: 'warning',
    completed: 'info',
    failed: 'danger',
    withdrawn: 'neutral',
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{term('cohort', true)}</CardTitle>
      </CardHeader>
      {enrollments.error ? <Alert tone="error">{errorMessage(enrollments.error)}</Alert> : null}
      {enrollments.data && items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Not enrolled in any {term('cohort').toLowerCase()} yet. Enroll them from a{' '}
          {term('cohort').toLowerCase()}&apos;s page.
        </p>
      ) : null}
      <ul className="divide-border divide-y">
        {items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div>
              <Link href={`/cohorts/${e.cohortId}`} className="font-medium hover:underline">
                {e.cohortName}
              </Link>
              <div className="text-muted-foreground text-xs">
                {e.completedAt
                  ? `${e.score ?? '—'}% score · ${e.attendancePercent ?? '—'}% attendance · ${formatDate(e.completedAt.slice(0, 10))}`
                  : e.waitlistPosition
                    ? `Waitlist place ${e.waitlistPosition}`
                    : e.enrolledAt
                      ? `Since ${formatDate(e.enrolledAt.slice(0, 10))}`
                      : ''}
              </div>
            </div>
            <Badge tone={tone[e.status]}>{cohortStatusLabel(e.status)}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function StudentDetailScreen({ studentId }: { studentId: string }) {
  const { term } = useInstitution();
  const { can } = useSession();
  const branches = useBranches();
  const student = useQuery({
    queryKey: ['students', 'one', studentId],
    queryFn: () => apiRequest(`/students/${studentId}`, { schema: studentSchema }),
  });
  const canEdit = can('students.manage');
  const [notice, setNotice] = useState<string | null>(null);

  if (student.error) {
    return <Alert tone="error">{errorMessage(student.error)}</Alert>;
  }
  const data = student.data;
  if (!data) return null;
  const branchName = branches.data?.items.find((b) => b.id === data.branchId)?.name;

  return (
    <div className="space-y-6">
      <Link href="/students" className="text-muted-foreground text-sm hover:underline">
        ← All {term('student', true).toLowerCase()}
      </Link>
      <SectionHeader
        title={`${data.givenName} ${data.fatherName} ${data.grandfatherName ?? ''}`.trim()}
        description={`${data.studentNumber}${branchName ? ` · ${branchName}` : ''} · registered ${new Date(data.createdAt).toLocaleDateString()}`}
        action={<StudentStatusBadge status={data.status} />}
      />
      {/* Keyed by version so a save (or someone else's) resets the forms to the stored values. */}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <DetailsForm
        key={`details-${data.version}`}
        student={data}
        canEdit={canEdit}
        onSaved={setNotice}
      />
      {can('enrollments.read') ? <ClassesCard studentId={data.id} /> : null}
      {can('billing.read') ? (
        <BillingCard studentId={data.id} canInvoice={can('billing.invoice')} />
      ) : null}
      <GuardiansCard
        key={`guardians-${data.version}`}
        student={data}
        canEdit={canEdit}
        onSaved={setNotice}
      />
    </div>
  );
}
