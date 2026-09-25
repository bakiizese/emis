'use client';

import { loginRequestSchema, loginResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest, errorMessage } from '@/lib/api';
import { pathForNextStep, safeNextPath } from '@/lib/redirects';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: values,
        schema: loginResponseSchema,
      });
      router.replace(pathForNextStep(result.nextStep, next));
    } catch (e) {
      setError(errorMessage(e));
      form.resetField('password');
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your staff email and password.</CardDescription>
      </CardHeader>
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </Card>
  );
}
