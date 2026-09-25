'use client';

import { type Institution, institutionSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest, errorMessage } from '@/lib/api';

import {
  INSTITUTION_DEFAULTS,
  InstitutionFields,
  type InstitutionFormInput,
  type InstitutionFormOutput,
  institutionFormSchema,
  institutionToForm,
} from './institution-fields';
import { SettingsHeader } from './settings-nav';

export function GeneralScreen() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const institution = useQuery({
    queryKey: ['institution', 'profile'],
    queryFn: () => apiRequest('/institution', { schema: institutionSchema }),
  });

  const form = useForm<InstitutionFormInput, unknown, InstitutionFormOutput>({
    resolver: zodResolver(institutionFormSchema),
    defaultValues: INSTITUTION_DEFAULTS,
  });
  const { reset } = form;
  useEffect(() => {
    if (institution.data) reset(institutionToForm(institution.data));
  }, [institution.data, reset]);

  const save = useMutation({
    mutationFn: (values: InstitutionFormOutput) =>
      apiRequest('/institution', {
        method: 'PATCH',
        body: values,
        schema: institutionSchema,
        ifMatch: institution.data?.version,
      }),
    onSuccess: async (updated: Institution) => {
      queryClient.setQueryData(['institution', 'profile'], updated);
      await queryClient.invalidateQueries({ queryKey: ['institution', 'public'] });
      setSaved(true);
    },
  });

  return (
    <>
      <SettingsHeader
        title="General"
        description="Your institution's name, contact details, branding and regional settings. They appear on the website, receipts and certificates."
      />
      {institution.error ? <Alert tone="error">{errorMessage(institution.error)}</Alert> : null}
      <Card>
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            setSaved(false);
            void form.handleSubmit((values) => save.mutate(values))(event);
          }}
        >
          <InstitutionFields form={form} />
          {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
          {saved ? <Alert tone="success">Saved.</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending || !institution.data}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
