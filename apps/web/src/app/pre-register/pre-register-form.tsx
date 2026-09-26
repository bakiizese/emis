'use client';

import {
  type PreRegistrationResponse,
  preRegistrationResponseSchema,
  problemDetailsSchema,
  type PublicBranch,
  type PublicCatalogResponse,
  type PublicClass,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { type FormEvent, useMemo, useState } from 'react';

import { formatDays, formatTime } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/idempotency';
import { intakeFor, validatePreRegistration } from '../../lib/pre-registration';

interface Props {
  catalog: PublicCatalogResponse;
  classes: PublicClass[];
  branches: PublicBranch[];
  initial: { courseId: string; shiftId: string; branchId: string };
}

type Fields = Record<string, string>;

const EMPTY: Fields = {
  givenName: '',
  fatherName: '',
  grandfatherName: '',
  gender: '',
  dateOfBirth: '',
  phone: '',
  email: '',
  city: '',
  guardianName: '',
  guardianPhone: '',
  message: '',
  companyWebsite: '',
};

async function send(body: unknown, key: string): Promise<PreRegistrationResponse> {
  let response: Response;
  try {
    response = await fetch('/api/v1/public/pre-registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("We can't reach the server. Check your connection and try again.");
  }
  if (response.ok) return preRegistrationResponseSchema.parse(await response.json());

  const problem = problemDetailsSchema.safeParse(await response.json().catch(() => null));
  if (response.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
  throw new Error(
    problem.success && problem.data.status < 500
      ? (problem.data.detail ?? problem.data.title)
      : 'Something went wrong on our side. Please try again.',
  );
}

export function PreRegisterForm({ catalog, classes, branches, initial }: Props) {
  const [values, setValues] = useState<Fields>(EMPTY);
  const [courseId, setCourseId] = useState(initial.courseId);
  const [shiftId, setShiftId] = useState(initial.shiftId);
  const [branchId, setBranchId] = useState(
    initial.branchId || (branches.length === 1 ? (branches[0]?.id ?? '') : ''),
  );
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<PreRegistrationResponse | null>(null);
  const idempotency = useIdempotencyKey();

  const courses = useMemo(
    () =>
      catalog.departments.flatMap((d) => d.programs.map((p) => ({ program: p, department: d }))),
    [catalog],
  );
  const shiftOptions = useMemo(() => {
    const seen = new Map<string, PublicClass['shift']>();
    for (const c of classes) if (c.courseId === courseId) seen.set(c.shift.id, c.shift);
    return [...seen.values()];
  }, [classes, courseId]);

  const set = (name: string) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: event.target.value }));

  function payload() {
    return {
      ...values,
      branchId,
      desiredCourseId: courseId,
      preferredShiftId: shiftId || null,
      preferredIntakeId: intakeFor(classes, { courseId, shiftId, branchId }),
      consent,
    };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const body = payload();
    const problems = validatePreRegistration(body);
    if (problems) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      setDone(await send(body, idempotency.keyFor(body)));
      idempotency.reset();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8 space-y-3">
        <Alert tone="success">
          <p className="font-medium">Thank you, we have your request.</p>
          {done.reference ? (
            <p className="mt-1">
              Your reference number is <strong className="font-mono">{done.reference}</strong>. Keep
              it and quote it if you call or visit. We will contact you soon.
            </p>
          ) : (
            <p className="mt-1">
              We already have a request from you open, and our staff will be in touch soon.
            </p>
          )}
        </Alert>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="mt-8 space-y-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">What you want to study</legend>
        <SelectField
          label="Course"
          value={courseId}
          error={errors.desiredCourseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setShiftId('');
          }}
        >
          <option value="">Choose a course…</option>
          {courses.map(({ program, department }) => (
            <optgroup key={program.id} label={`${department.name} · ${program.name}`}>
              {program.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <SelectField
          label="Preferred shift"
          value={shiftId}
          onChange={(e) => setShiftId(e.target.value)}
        >
          <option value="">No preference</option>
          {shiftOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({formatDays(s.daysOfWeek)}, {formatTime(s.startTime)}–
              {formatTime(s.endTime)})
            </option>
          ))}
        </SelectField>
        {branches.length > 1 ? (
          <SelectField
            label="Branch"
            value={branchId}
            error={errors.branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Choose a branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            value={values.givenName}
            onChange={set('givenName')}
            error={errors.givenName}
            autoComplete="given-name"
            required
          />
          <Field
            label="Father's name"
            value={values.fatherName}
            onChange={set('fatherName')}
            error={errors.fatherName}
            required
          />
          <Field
            label="Grandfather's name"
            hint="Optional"
            value={values.grandfatherName}
            onChange={set('grandfatherName')}
            error={errors.grandfatherName}
          />
          <SelectField
            label="Gender"
            value={values.gender}
            onChange={set('gender')}
            error={errors.gender}
          >
            <option value="">Choose…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </SelectField>
          <Field
            label="Date of birth"
            type="date"
            hint="Optional"
            value={values.dateOfBirth}
            onChange={set('dateOfBirth')}
            error={errors.dateOfBirth}
            autoComplete="bday"
          />
          <Field
            label="City"
            hint="Optional"
            value={values.city}
            onChange={set('city')}
            error={errors.city}
            autoComplete="address-level2"
          />
          <Field
            label="Phone"
            type="tel"
            inputMode="tel"
            placeholder="0911 22 33 44"
            value={values.phone}
            onChange={set('phone')}
            error={errors.phone}
            autoComplete="tel"
            required
          />
          <Field
            label="Email"
            type="email"
            hint="Optional. We send your reference here."
            value={values.email}
            onChange={set('email')}
            error={errors.email}
            autoComplete="email"
          />
        </div>
      </fieldset>

      <details className="border-border rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Applying for someone under 18?
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Parent or guardian's name"
            value={values.guardianName}
            onChange={set('guardianName')}
            error={errors.guardianName}
          />
          <Field
            label="Parent or guardian's phone"
            type="tel"
            inputMode="tel"
            value={values.guardianPhone}
            onChange={set('guardianPhone')}
            error={errors.guardianPhone}
          />
        </div>
      </details>

      <div className="space-y-1.5">
        <label htmlFor="message" className="text-sm font-medium">
          Anything you want us to know?{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="message"
          rows={3}
          maxLength={500}
          value={values.message}
          onChange={set('message')}
          className="border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        {errors.message ? (
          <p className="text-sm text-red-700 dark:text-red-300">{errors.message}</p>
        ) : null}
      </div>

      {/* A trap for bots: hidden from people and from the keyboard. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company website
          <input
            type="text"
            name="companyWebsite"
            tabIndex={-1}
            autoComplete="off"
            value={values.companyWebsite}
            onChange={set('companyWebsite')}
          />
        </label>
      </div>

      <div>
        <CheckboxField
          label="You may contact me about this request"
          description="We use your details only to answer your request and to help you enrol."
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {errors.consent ? (
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.consent}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? 'Sending…' : 'Send my request'}
      </Button>
    </form>
  );
}
