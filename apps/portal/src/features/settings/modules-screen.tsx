'use client';

import { moduleListResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Card } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest, errorMessage } from '@/lib/api';

import { SettingsHeader } from './settings-nav';

export function ModulesScreen() {
  const queryClient = useQueryClient();
  const modules = useQuery({
    queryKey: ['modules'],
    queryFn: () => apiRequest('/modules', { schema: moduleListResponseSchema }),
  });

  const set = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiRequest(`/modules/${key}`, {
        method: 'PUT',
        body: { enabled },
        schema: moduleListResponseSchema,
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['modules'], result);
      await queryClient.invalidateQueries({ queryKey: ['institution', 'public'] });
    },
  });

  const names = new Map(modules.data?.items.map((m) => [m.key, m.name]));
  return (
    <>
      <SettingsHeader
        title="Modules"
        description="Switch off what you don't use. Switched-off features disappear from the portal and the website; no data is deleted."
      />
      {set.error ? <Alert tone="error">{errorMessage(set.error)}</Alert> : null}
      {modules.error ? <Alert tone="error">{errorMessage(modules.error)}</Alert> : null}
      <Card className="space-y-5">
        {modules.data?.items.map((mod) => (
          <CheckboxField
            key={mod.key}
            label={mod.name}
            description={
              mod.requires.length > 0
                ? `${mod.description} Needs ${mod.requires.map((r) => names.get(r) ?? r).join(', ')}.`
                : mod.description
            }
            checked={mod.enabled}
            disabled={set.isPending}
            onChange={(event) => set.mutate({ key: mod.key, enabled: event.target.checked })}
          />
        ))}
      </Card>
    </>
  );
}
