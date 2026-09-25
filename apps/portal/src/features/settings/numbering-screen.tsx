'use client';

import {
  checkNumberPattern,
  formatNumber,
  NUMBER_TOKENS,
  type NumberSeries,
  numberSeriesListResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiRequest, errorMessage } from '@/lib/api';

import { SettingsHeader } from './settings-nav';

const now = new Date();
const SAMPLE = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  fiscalYear: now.getFullYear(),
  branchCode: 'MAIN',
};

function SeriesRow({ series }: { series: NumberSeries }) {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState(series.pattern);
  const problem = checkNumberPattern(pattern.trim());

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/number-series/${series.key}`, {
        method: 'PUT',
        body: { pattern: pattern.trim() },
        schema: numberSeriesListResponseSchema,
      }),
    onSuccess: (result) => queryClient.setQueryData(['number-series'], result),
  });

  return (
    <form
      className="grid items-start gap-3 sm:grid-cols-[1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label={series.name}
        value={pattern}
        onChange={(event) => setPattern(event.target.value)}
        error={problem ?? (save.error ? errorMessage(save.error) : undefined)}
        hint={`Next one looks like ${formatNumber(pattern.trim(), SAMPLE, 1)}${
          pattern.trim() === series.defaultPattern ? ' (default)' : ''
        }`}
      />
      <div className="flex gap-2 sm:pt-7">
        <Button
          variant="ghost"
          disabled={pattern === series.defaultPattern}
          onClick={() => setPattern(series.defaultPattern)}
        >
          Default
        </Button>
        <Button
          type="submit"
          variant="secondary"
          disabled={problem !== null || pattern.trim() === series.pattern || save.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

export function NumberingScreen() {
  const series = useQuery({
    queryKey: ['number-series'],
    queryFn: () => apiRequest('/number-series', { schema: numberSeriesListResponseSchema }),
  });

  return (
    <>
      <SettingsHeader
        title="Numbering"
        description="How student numbers, receipts and other documents are numbered. Numbers never repeat or skip. Changing a pattern affects new numbers only."
      />
      <Alert>
        Placeholders: {NUMBER_TOKENS.map((t) => `{${t}}`).join(' ')} and {'{SEQ:n}'} for the running
        number padded to n digits. {'{FY}'} is the year your fiscal year started; {'{BRANCH}'}{' '}
        counts each branch separately.
      </Alert>
      {series.error ? <Alert tone="error">{errorMessage(series.error)}</Alert> : null}
      <Card className="space-y-6">
        {series.data?.items.map((s) => (
          <SeriesRow key={`${s.key}:${s.pattern}`} series={s} />
        ))}
      </Card>
    </>
  );
}
