import { LinkButton } from '../components/link-button';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground mt-2">The page you are looking for isn&apos;t here.</p>
      <LinkButton href="/" className="mt-6">
        Go to the home page
      </LinkButton>
    </main>
  );
}
