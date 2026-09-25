'use client';

import type { personFieldsSchema } from '@emis/contracts';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { useFormContext } from 'react-hook-form';
import type { z } from 'zod';

/** The fields every person form has; parents wrap their form in <FormProvider>. */
export type PersonFormValues = z.input<typeof personFieldsSchema>;

/** Form defaults from a stored person (nulls become empty inputs). */
export function personToForm(person?: {
  givenName: string;
  fatherName: string;
  grandfatherName: string | null;
  gender: 'female' | 'male';
  dateOfBirth: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
}): PersonFormValues {
  return {
    givenName: person?.givenName ?? '',
    fatherName: person?.fatherName ?? '',
    grandfatherName: person?.grandfatherName ?? '',
    gender: person?.gender ?? 'female',
    dateOfBirth: person?.dateOfBirth ?? '',
    phone: person?.phone ?? '',
    email: person?.email ?? '',
    address: person?.address ?? '',
    city: person?.city ?? '',
  };
}

export function PersonFields() {
  const { register, formState } = useFormContext<PersonFormValues>();
  const { errors } = formState;

  return (
    <fieldset className="grid gap-4 sm:grid-cols-3">
      <legend className="mb-3 text-sm font-semibold">Personal details</legend>
      <Field label="First name" error={errors.givenName?.message} {...register('givenName')} />
      <Field label="Father's name" error={errors.fatherName?.message} {...register('fatherName')} />
      <Field
        label="Grandfather's name (optional)"
        error={errors.grandfatherName?.message}
        {...register('grandfatherName')}
      />
      <SelectField label="Gender" error={errors.gender?.message} {...register('gender')}>
        <option value="female">Female</option>
        <option value="male">Male</option>
      </SelectField>
      <Field
        label="Date of birth (optional)"
        type="date"
        error={errors.dateOfBirth?.message}
        {...register('dateOfBirth')}
      />
      <Field
        label="Phone"
        type="tel"
        placeholder="0911 22 33 44"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Field
        label="Email (optional)"
        type="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <Field label="City (optional)" error={errors.city?.message} {...register('city')} />
      <Field label="Address (optional)" error={errors.address?.message} {...register('address')} />
    </fieldset>
  );
}
