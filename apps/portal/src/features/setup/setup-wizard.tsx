'use client';

import {
  type CompleteSetupRequest,
  createBranchRequestSchema,
  createDepartmentRequestSchema,
  institutionSchema,
  setupStatusResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Input } from '@emis/ui/components/input';
import { cn } from '@emis/ui/lib/cn';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  INSTITUTION_DEFAULTS,
  InstitutionFields,
  type InstitutionFormInput,
  type InstitutionFormOutput,
  institutionFormSchema,
} from '@/features/settings/institution-fields';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

const STEPS = ['Institution', 'Branches', 'Departments', 'Finish'] as const;

interface UnitRow {
  code: string;
  name: string;
}

/** Validate code/name rows with the contract; returns the first problem, if any. */
function rowsProblem(rows: UnitRow[], what: string, min: number): string | null {
  const filled = rows.filter((r) => r.code.trim() || r.name.trim());
  if (filled.length < min) return `Add at least ${min} ${what}.`;
  const schema = what === 'branch' ? createBranchRequestSchema : createDepartmentRequestSchema;
  for (const row of filled) {
    const result = schema.safeParse(row);
    if (!result.success) {
      const issue = result.error.issues[0];
      return `${row.name || row.code || 'A row'}: ${String(issue?.path[0] ?? '')} ${issue?.message ?? 'is invalid'}`;
    }
  }
  const codes = filled.map((r) => r.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length) return 'Each code must be different.';
  return null;
}

function UnitRows({
  rows,
  onChange,
  placeholder,
}: {
  rows: UnitRow[];
  onChange: (rows: UnitRow[]) => void;
  placeholder: UnitRow;
}) {
  const set = (index: number, patch: Partial<UnitRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[7rem_1fr_auto] gap-2">
          <Input
            aria-label="Code"
            placeholder={placeholder.code}
            value={row.code}
            maxLength={10}
            onChange={(event) => set(index, { code: event.target.value.toUpperCase() })}
          />
          <Input
            aria-label="Name"
            placeholder={placeholder.name}
            value={row.name}
            maxLength={120}
            onChange={(event) => set(index, { name: event.target.value })}
          />
          <Button
            variant="ghost"
            aria-label="Remove"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...rows, { code: '', name: '' }])}>
        Add another
      </Button>
    </div>
  );
}

export function SetupWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [institution, setInstitution] = useState<InstitutionFormOutput | null>(null);
  const [branches, setBranches] = useState<UnitRow[]>([{ code: 'MAIN', name: 'Main campus' }]);
  const [presets, setPresets] = useState<Set<string>>(new Set());
  const [departments, setDepartments] = useState<UnitRow[]>([]);
  const [seedLists, setSeedLists] = useState(true);

  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () => apiRequest('/setup', { schema: setupStatusResponseSchema }),
  });
  const form = useForm<InstitutionFormInput, unknown, InstitutionFormOutput>({
    resolver: zodResolver(institutionFormSchema),
    defaultValues: INSTITUTION_DEFAULTS,
  });

  const finish = useMutation({
    mutationFn: () => {
      if (!institution) throw new Error('Institution details missing');
      const body: CompleteSetupRequest = {
        institution,
        branches: branches.filter((b) => b.code.trim() || b.name.trim()),
        presets: [...presets],
        departments: departments.filter((d) => d.code.trim() || d.name.trim()),
        seedDefaultLists: seedLists,
      };
      return apiRequest('/setup', {
        method: 'POST',
        body,
        schema: institutionSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.replace('/');
    },
  });

  if (status.error) return <Alert tone="error">{errorMessage(status.error)}</Alert>;
  if (!status.data) return null;
  if (status.data.completed) {
    return (
      <Alert>
        Setup is done. Change anything from{' '}
        <Link href="/settings" className="underline">
          Settings
        </Link>
        .
      </Alert>
    );
  }

  const presetList = status.data.presets;
  const presetDepartments = presetList
    .filter((p) => presets.has(p.key))
    .flatMap((p) => p.departments);

  function next() {
    setProblem(null);
    if (step === 1) {
      const issue = rowsProblem(branches, 'branch', 1);
      if (issue) return setProblem(issue);
    }
    if (step === 2) {
      const issue = rowsProblem(departments, 'department', 0);
      if (issue) return setProblem(issue);
      if (presetDepartments.length === 0 && departments.every((d) => !d.code.trim())) {
        return setProblem('Pick a starting pack or add at least one department.');
      }
    }
    setStep((s) => s + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your institution</h1>
        <p className="text-muted-foreground text-sm">
          A few details to get started. Everything can be changed later in Settings.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={cn(
              'rounded-full px-3 py-1',
              index === step
                ? 'bg-primary text-primary-foreground'
                : index < step
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <form
            className="space-y-6"
            noValidate
            onSubmit={(event) =>
              void form.handleSubmit((values) => {
                setInstitution(values);
                setStep(1);
              })(event)
            }
          >
            <InstitutionFields form={form} />
            <div className="flex justify-end">
              <Button type="submit">Next</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
            <CardDescription>
              Your campuses or sites. Just one? Keep the main campus and rename it.
            </CardDescription>
          </CardHeader>
          <UnitRows
            rows={branches}
            onChange={setBranches}
            placeholder={{ code: 'BOLE', name: 'Bole campus' }}
          />
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="space-y-6">
          <CardHeader className="mb-0">
            <CardTitle className="text-base">Departments</CardTitle>
            <CardDescription>
              What you teach. Start from one or more packs, add your own, or both.
            </CardDescription>
          </CardHeader>
          <div className="space-y-4">
            {presetList.map((preset) => (
              <CheckboxField
                key={preset.key}
                label={preset.name}
                description={`${preset.description} Adds: ${preset.departments.map((d) => d.name).join(', ')}.`}
                checked={presets.has(preset.key)}
                onChange={(event) => {
                  const nextSet = new Set(presets);
                  if (event.target.checked) nextSet.add(preset.key);
                  else nextSet.delete(preset.key);
                  setPresets(nextSet);
                }}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Your own departments</p>
            <UnitRows
              rows={departments}
              onChange={setDepartments}
              placeholder={{ code: 'MUSIC', name: 'Music' }}
            />
          </div>
        </Card>
      ) : null}

      {step === 3 && institution ? (
        <Card className="space-y-5">
          <CardHeader className="mb-0">
            <CardTitle className="text-base">Ready to finish</CardTitle>
            <CardDescription>Check the summary, then finish setup.</CardDescription>
          </CardHeader>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Institution</dt>
            <dd>
              {institution.name} ({institution.shortName})
            </dd>
            <dt className="text-muted-foreground">Region</dt>
            <dd>
              {institution.currency} · {institution.timezone} · fiscal year from{' '}
              {institution.fiscalYearStart}
            </dd>
            <dt className="text-muted-foreground">Branches</dt>
            <dd>
              {branches
                .filter((b) => b.name.trim())
                .map((b) => b.name)
                .join(', ')}
            </dd>
            <dt className="text-muted-foreground">Departments</dt>
            <dd>
              {[
                ...presetDepartments.map((d) => d.name),
                ...departments.filter((d) => d.name.trim()).map((d) => d.name),
              ].join(', ')}
            </dd>
          </dl>
          <CheckboxField
            label="Fill the dropdown lists with common values"
            description="Student categories, how applicants heard about you, discount and withdrawal reasons. You can edit them afterwards."
            checked={seedLists}
            onChange={(event) => setSeedLists(event.target.checked)}
          />
          {finish.error ? <Alert tone="error">{errorMessage(finish.error)}</Alert> : null}
        </Card>
      ) : null}

      {problem ? <Alert tone="error">{problem}</Alert> : null}

      {step > 0 ? (
        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={finish.isPending}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={() => finish.mutate()} disabled={finish.isPending}>
              {finish.isPending ? 'Finishing…' : 'Finish setup'}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
