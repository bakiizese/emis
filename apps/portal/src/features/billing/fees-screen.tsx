'use client';

import {
  type FeeComponent,
  feeStructureSchema,
  paymentPlanSchema,
  type PlanInstallment,
  parseMoney,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { formatDate } from '@/features/academics/use-catalog';
import { useCourseOptions } from '@/features/admissions/use-course-options';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useMoney } from './money';
import { useFeeStructures, usePaymentPlans } from './use-billing';

interface ComponentRow {
  name: string;
  amount: string;
}

function StructureForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const courses = useCourseOptions();
  const categories = useDescriptorOptions('student_category');
  const idempotency = useIdempotencyKey();
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [rows, setRows] = useState<ComponentRow[]>([{ name: 'Tuition', amount: '' }]);

  const components = rows.map((r) => ({ name: r.name.trim(), amount: parseMoney(r.amount) }));
  const valid = components.every(
    (c): c is FeeComponent => c.name.length >= 2 && c.amount !== null && c.amount > 0,
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        courseId,
        categoryCode: categoryCode || null,
        effectiveFrom,
        components,
      };
      return apiRequest('/fee-structures', {
        method: 'POST',
        body,
        schema: feeStructureSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fee-structures'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Set a course fee</CardTitle>
      </CardHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            placeholder="e.g. A2 standard fee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <SelectField
            label="Course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            required
          >
            <option value="">Choose…</option>
            {courses.options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <Field
            label="Applies from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
            hint="Classes starting on or after this date use this price."
          />
          <SelectField
            label="Student category (optional)"
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
          >
            <option value="">Everyone</option>
            {categories.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">What it covers</p>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_10rem_auto] gap-2">
              <Input
                aria-label="Component"
                placeholder="Tuition, registration, materials…"
                value={row.name}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
              />
              <Input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                value={row.amount}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                }
              />
              <Button
                variant="ghost"
                aria-label="Remove"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={rows.length >= 10}
            onClick={() => setRows([...rows, { name: '', amount: '' }])}
          >
            Add another
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Prices are never edited after they're used. To change one, add a new fee that applies from
          a later date.
        </p>
        {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!valid || !name || !courseId || !effectiveFrom || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save fee'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface PlanRow {
  percent: string;
  days: string;
}

function PlanForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [rows, setRows] = useState<PlanRow[]>([
    { percent: '50', days: '0' },
    { percent: '50', days: '30' },
  ]);

  const installments: PlanInstallment[] = rows.map((r) => ({
    shareBp: Math.round(Number(r.percent) * 100),
    dueOffsetDays: Math.round(Number(r.days)),
  }));
  const total = installments.reduce(
    (sum, i) => sum + (Number.isFinite(i.shareBp) ? i.shareBp : 0),
    0,
  );
  const valid =
    total === 10_000 && installments.every((i) => i.shareBp > 0 && i.dueOffsetDays >= 0);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, isDefault, installments };
      return apiRequest('/payment-plans', {
        method: 'POST',
        body,
        schema: paymentPlanSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payment-plans'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a payment plan</CardTitle>
      </CardHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Name"
          placeholder="e.g. Three payments"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">Instalments</p>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field
                label={`#${i + 1} share (%)`}
                inputMode="decimal"
                value={row.percent}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, percent: e.target.value } : r)))
                }
              />
              <Field
                label="Due (days after the invoice)"
                inputMode="numeric"
                value={row.days}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, days: e.target.value } : r)))
                }
              />
              <Button
                variant="ghost"
                aria-label="Remove"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              disabled={rows.length >= 12}
              onClick={() => setRows([...rows, { percent: '', days: '' }])}
            >
              Add instalment
            </Button>
            <span
              className={
                total === 10_000
                  ? 'text-sm text-green-700 dark:text-green-300'
                  : 'text-sm text-red-700 dark:text-red-300'
              }
            >
              Total {(total / 100).toFixed(2)}% {total === 10_000 ? '' : '(must be 100%)'}
            </span>
          </div>
        </div>
        <CheckboxField
          label="Use as the default plan"
          description="Invoices use it unless another plan is chosen."
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || !name || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save plan'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function FeesScreen() {
  const { can } = useSession();
  const { fmt } = useMoney();
  const courses = useCourseOptions();
  const structures = useFeeStructures();
  const plans = usePaymentPlans();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<'fee' | 'plan' | null>(null);
  const canManage = can('fees.manage');

  const retire = useMutation({
    mutationFn: (s: { id: string; version: number; isActive: boolean }) =>
      apiRequest(`/fee-structures/${s.id}`, {
        method: 'PATCH',
        body: { isActive: !s.isActive },
        schema: feeStructureSchema,
        ifMatch: s.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['fee-structures'] }),
  });
  const setDefault = useMutation({
    mutationFn: (p: { id: string; version: number }) =>
      apiRequest(`/payment-plans/${p.id}`, {
        method: 'PATCH',
        body: { isDefault: true },
        schema: paymentPlanSchema,
        ifMatch: p.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['payment-plans'] }),
  });

  const courseName = (id: string) => courses.options.find((c) => c.id === id)?.label ?? '—';

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SectionHeader
          title="Course fees"
          description="What each course costs, from a date. A student's invoice uses the newest fee that had started when their class begins, and a category price beats the general one."
          action={
            canManage && adding === null ? (
              <Button onClick={() => setAdding('fee')}>Set a fee</Button>
            ) : null
          }
        />
        {adding === 'fee' ? <StructureForm onDone={() => setAdding(null)} /> : null}
        {retire.error ? <Alert tone="error">{errorMessage(retire.error)}</Alert> : null}
        {structures.error ? <Alert tone="error">{errorMessage(structures.error)}</Alert> : null}
        <SimpleTable
          head={['Fee', 'Course', 'From', 'Total', 'Status', '']}
          empty={
            !structures.isPending && (structures.data?.items.length ?? 0) === 0
              ? 'No fees yet. Invoices can only be created once a course has one.'
              : null
          }
        >
          {structures.data?.items.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-muted-foreground text-xs">
                  {s.components.map((c) => `${c.name} ${fmt(c.amount)}`).join(' · ')}
                  {s.categoryCode ? ` · for ${s.categoryCode}` : ''}
                </div>
              </td>
              <td className="px-4 py-3">{courseName(s.courseId)}</td>
              <td className="px-4 py-3">{formatDate(s.effectiveFrom)}</td>
              <td className="px-4 py-3 font-medium">{fmt(s.total)}</td>
              <td className="px-4 py-3">
                <Badge tone={s.isActive ? 'success' : 'neutral'}>
                  {s.isActive ? 'In use' : 'Retired'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                {canManage ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={retire.isPending}
                    onClick={() => retire.mutate(s)}
                  >
                    {s.isActive ? 'Retire' : 'Restore'}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </SimpleTable>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="Payment plans"
          description="How an invoice is split into instalments. The default plan is used unless another is chosen."
          action={
            canManage && adding === null ? (
              <Button variant="secondary" onClick={() => setAdding('plan')}>
                Add a plan
              </Button>
            ) : null
          }
        />
        {adding === 'plan' ? <PlanForm onDone={() => setAdding(null)} /> : null}
        {setDefault.error ? <Alert tone="error">{errorMessage(setDefault.error)}</Alert> : null}
        <SimpleTable
          head={['Plan', 'Instalments', 'Status', '']}
          empty={!plans.isPending && (plans.data?.items.length ?? 0) === 0 ? 'No plans yet.' : null}
        >
          {plans.data?.items.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 font-medium">{p.name}</td>
              <td className="text-muted-foreground px-4 py-3">
                {p.installments
                  .map((i) => `${i.shareBp / 100}% on day ${i.dueOffsetDays}`)
                  .join(' · ')}
              </td>
              <td className="px-4 py-3">
                {p.isDefault ? (
                  <Badge tone="info">Default</Badge>
                ) : (
                  <Badge tone={p.isActive ? 'success' : 'neutral'}>
                    {p.isActive ? 'In use' : 'Retired'}
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {canManage && !p.isDefault && p.isActive ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate(p)}
                  >
                    Make default
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </SimpleTable>
      </div>
    </div>
  );
}
