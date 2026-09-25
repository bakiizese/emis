export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}

/** Injection token: `@Inject(MAILER) mailer: Mailer`. Tests swap in a capturing mailer. */
export const MAILER = Symbol('MAILER');
