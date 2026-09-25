import { Button } from '@emis/ui/components/button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4">
      <h1 className="text-4xl font-semibold">Learn with us</h1>
      <p className="text-muted-foreground text-lg">
        Browse our departments, pick a shift that fits your day and pre-register online.
      </p>
      <div>
        <Button disabled>Browse courses</Button>
      </div>
    </main>
  );
}
