'use client';

import { type Institution, updateInstitutionRequestSchema } from '@emis/contracts';
import { Field } from '@emis/ui/components/field';
import { Label } from '@emis/ui/components/label';
import { SelectField } from '@emis/ui/components/select';
import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

/** Every profile field, required (the API accepts partial updates; the form always sends all). */
export const institutionFormSchema = updateInstitutionRequestSchema.required();
export type InstitutionFormInput = z.input<typeof institutionFormSchema>;
export type InstitutionFormOutput = z.output<typeof institutionFormSchema>;
export type InstitutionForm = UseFormReturn<InstitutionFormInput, unknown, InstitutionFormOutput>;

export const INSTITUTION_DEFAULTS: InstitutionFormInput = {
  name: '',
  shortName: '',
  tagline: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  city: '',
  country: 'ET',
  primaryColor: '#1d4ed8',
  locale: 'en',
  currency: 'ETB',
  timezone: 'Africa/Addis_Ababa',
  calendarDisplay: 'gregorian',
  fiscalYearStart: '07-08',
};

/** Form values from a stored institution (nulls become empty inputs). */
export function institutionToForm(institution: Institution): InstitutionFormInput {
  return {
    name: institution.name,
    shortName: institution.shortName,
    tagline: institution.tagline ?? '',
    email: institution.email ?? '',
    phone: institution.phone ?? '',
    website: institution.website ?? '',
    address: institution.address ?? '',
    city: institution.city ?? '',
    country: institution.country,
    primaryColor: institution.primaryColor,
    locale: institution.locale,
    currency: institution.currency,
    timezone: institution.timezone,
    calendarDisplay: institution.calendarDisplay,
    fiscalYearStart: institution.fiscalYearStart,
  };
}

const TIME_ZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function InstitutionFields({ form }: { form: InstitutionForm }) {
  const { register } = form;
  const { errors } = form.formState;

  return (
    <div className="space-y-8">
      <Section title="Identity">
        <Field label="Full name" error={errors.name?.message} {...register('name')} />
        <Field
          label="Short name"
          hint="Shown in the portal header, e.g. an acronym."
          error={errors.shortName?.message}
          {...register('shortName')}
        />
        <div className="sm:col-span-2">
          <Field
            label="Tagline (optional)"
            error={errors.tagline?.message}
            {...register('tagline')}
          />
        </div>
      </Section>

      <Section title="Contact">
        <Field
          label="Email (optional)"
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Field label="Phone (optional)" error={errors.phone?.message} {...register('phone')} />
        <Field
          label="Website (optional)"
          placeholder="https://"
          error={errors.website?.message}
          {...register('website')}
        />
        <Field label="City (optional)" error={errors.city?.message} {...register('city')} />
        <Field
          label="Address (optional)"
          error={errors.address?.message}
          {...register('address')}
        />
        <Field
          label="Country code"
          hint="Two letters, e.g. ET."
          maxLength={2}
          error={errors.country?.message}
          {...register('country')}
        />
      </Section>

      <Section title="Branding and region">
        <div className="space-y-1.5">
          <Label htmlFor="primary-color">Brand colour</Label>
          <input
            id="primary-color"
            type="color"
            className="border-border h-10 w-20 cursor-pointer rounded-md border bg-transparent"
            {...register('primaryColor')}
          />
          {errors.primaryColor ? (
            <p className="text-sm text-red-700 dark:text-red-300">{errors.primaryColor.message}</p>
          ) : null}
        </div>
        <SelectField label="Language" error={errors.locale?.message} {...register('locale')}>
          <option value="en">English</option>
          <option value="am">Amharic (አማርኛ)</option>
        </SelectField>
        <Field
          label="Currency"
          hint="Three letters, e.g. ETB."
          maxLength={3}
          error={errors.currency?.message}
          {...register('currency')}
        />
        <div>
          <Field
            label="Time zone"
            list="time-zones"
            error={errors.timezone?.message}
            {...register('timezone')}
          />
          <datalist id="time-zones">
            {TIME_ZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>
        <SelectField
          label="Dates shown in"
          error={errors.calendarDisplay?.message}
          {...register('calendarDisplay')}
        >
          <option value="gregorian">Gregorian calendar</option>
          <option value="ethiopian">Ethiopian calendar</option>
          <option value="both">Both</option>
        </SelectField>
        <Field
          label="Fiscal year starts (MM-DD)"
          hint="Ethiopia: 07-08 (Hamle 1)."
          error={errors.fiscalYearStart?.message}
          {...register('fiscalYearStart')}
        />
      </Section>
    </div>
  );
}
