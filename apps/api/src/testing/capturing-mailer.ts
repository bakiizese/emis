import type { Mailer, OutgoingEmail } from '../mail/mailer.js';

/** Test double: keeps sent emails in memory instead of talking to SMTP. */
export class CapturingMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];

  send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }

  lastTo(address: string): OutgoingEmail | undefined {
    return this.sent.filter((email) => email.to === address).at(-1);
  }
}
