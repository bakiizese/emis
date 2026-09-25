'use client';

import { Badge } from '@emis/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';

import { useSession } from './use-session';

export function HomeScreen() {
  const { me, access } = useSession();
  if (!me) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {me.user.displayName}</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Your account</CardTitle>
          <CardDescription>{me.user.email}</CardDescription>
        </CardHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {access?.roles.length
              ? access.roles.map((r) => (
                  <Badge key={r.key} tone="info">
                    {r.name}
                  </Badge>
                ))
              : 'None yet'}
          </dd>
          <dt className="text-muted-foreground">Two-factor</dt>
          <dd>{me.user.mfaEnabled ? 'On' : 'Off'}</dd>
        </dl>
      </Card>
    </div>
  );
}
