'use client';

import {
  type SetTerminologyRequest,
  type TermKey,
  terminologyResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { Input } from '@emis/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiRequest, errorMessage } from '@/lib/api';

import { SettingsHeader } from './settings-nav';

type Draft = Record<string, { singular: string; plural: string }>;

export function TerminologyScreen() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState(false);
  const terms = useQuery({
    queryKey: ['terminology'],
    queryFn: () => apiRequest('/terminology', { schema: terminologyResponseSchema }),
  });

  // The draft holds only the edits; everything else shows what's saved.
  const current = (key: TermKey) => {
    const saved = terms.data?.items.find((t) => t.key === key);
    return draft[key] ?? { singular: saved?.singular ?? '', plural: saved?.plural ?? '' };
  };

  const save = useMutation({
    mutationFn: () =>
      apiRequest('/terminology', {
        method: 'PUT',
        body: {
          overrides: Object.fromEntries(
            (terms.data?.items ?? []).map((t) => [t.key, current(t.key)]),
          ),
        } satisfies SetTerminologyRequest,
        schema: terminologyResponseSchema,
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['terminology'], result);
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ['institution', 'public'] });
      setSaved(true);
    },
  });

  const update = (key: TermKey, field: 'singular' | 'plural', value: string) => {
    setSaved(false);
    setDraft((d) => ({
      ...d,
      [key]: { ...(d[key] ?? { singular: '', plural: '' }), [field]: value },
    }));
  };

  return (
    <>
      <SettingsHeader
        title="Terminology"
        description="Use your own words across the portal and website, e.g. call a cohort a “Batch” or a shift a “Session”."
      />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="text-muted-foreground grid grid-cols-[8rem_1fr_1fr_auto] gap-3 text-xs font-medium uppercase">
            <span>Default</span>
            <span>Singular</span>
            <span>Plural</span>
            <span className="sr-only">Reset</span>
          </div>
          {terms.data?.items.map((term) => {
            const value = current(term.key);
            const changed =
              value.singular !== term.defaultSingular || value.plural !== term.defaultPlural;
            return (
              <div key={term.key} className="grid grid-cols-[8rem_1fr_1fr_auto] items-center gap-3">
                <span className="text-sm">{term.defaultSingular}</span>
                <Input
                  aria-label={`${term.defaultSingular}, singular`}
                  value={value.singular}
                  maxLength={40}
                  onChange={(event) => update(term.key, 'singular', event.target.value)}
                />
                <Input
                  aria-label={`${term.defaultSingular}, plural`}
                  value={value.plural}
                  maxLength={40}
                  onChange={(event) => update(term.key, 'plural', event.target.value)}
                />
                <Button
                  variant="ghost"
                  className="h-8 px-3"
                  disabled={!changed}
                  onClick={() => {
                    update(term.key, 'singular', term.defaultSingular);
                    update(term.key, 'plural', term.defaultPlural);
                  }}
                >
                  Reset
                </Button>
              </div>
            );
          })}
          {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
          {saved ? <Alert tone="success">Saved.</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending || !terms.data}>
              {save.isPending ? 'Saving…' : 'Save wording'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
