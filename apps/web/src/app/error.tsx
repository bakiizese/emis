'use client';

import { Button } from '@emis/ui/components/button';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground mt-2">
        We couldn&apos;t load this page. Please try again.
      </p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  );
}
