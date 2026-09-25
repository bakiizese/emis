import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../config/env.js';
import type { Mailer, OutgoingEmail } from './mailer.js';

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly env: Env) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, ...email });
  }
}
