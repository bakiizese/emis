import { AccountSummary } from '@/features/auth/account-summary';

export default function PortalHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <AccountSummary />
    </main>
  );
}
