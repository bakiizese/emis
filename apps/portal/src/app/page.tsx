import { Button } from '@emis/ui/components/button';

export default function PortalHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">EMIS</p>
        <h1 className="text-3xl font-semibold">Staff portal</h1>
        <p className="text-muted-foreground">
          Sign in to manage admissions, students, payments and reports.
        </p>
      </div>
      <Button disabled>Sign in</Button>
    </main>
  );
}
