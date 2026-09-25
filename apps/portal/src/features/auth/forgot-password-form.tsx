'use client';

import { forgotPasswordRequestSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest, errorMessage } from '@/lib/api';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiRequest('/auth/password/forgot', { method: 'POST', body: values });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to choose a new password.</CardDescription>
      </CardHeader>
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">
            If an account exists for that email, a reset link is on its way. It expires in 30
            minutes.
          </Alert>
          <Link
            href="/login"
            className="text-muted-foreground block text-center text-sm hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
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
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <Link
            href="/login"
            className="text-muted-foreground block text-center text-sm hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </Card>
  );
}
