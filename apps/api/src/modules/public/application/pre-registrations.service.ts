import type { PreRegistrationResponse, PreRegistrationValues } from '@emis/contracts';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';

import { EmailOutbox } from '../../../mail/email-outbox.service.js';
import { ApplicationsService } from '../../admissions/index.js';
import { InstitutionService } from '../../settings/index.js';
import { preRegistrationEmail } from '../domain/pre-registration-email.js';
import { PublicCatalogService } from './public-catalog.service.js';

/**
 * Turns a website form into an application in the admissions queue, and emails the applicant a
 * reference. Anti-abuse lives here and at the route: a filled honeypot gets a normal-looking
 * answer and nothing is stored, and the route is rate limited and idempotent.
 */
@Injectable()
export class PreRegistrationsService {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly applications: ApplicationsService,
    private readonly institution: InstitutionService,
    private readonly emails: EmailOutbox,
  ) {}

  @Transactional()
  async submit(input: PreRegistrationValues): Promise<PreRegistrationResponse> {
    if (input.companyWebsite.trim() !== '') return { received: true, reference: null };

    const courseName = await this.catalog.assertPreRegistrable(
      input.desiredCourseId,
      input.preferredShiftId,
    );
    const { reference } = await this.applications.submitFromWebsite(input);

    if (reference && input.email) {
      const { name: institutionName } = await this.institution.get();
      await this.emails.send({
        to: input.email,
        ...preRegistrationEmail({
          applicantName: input.givenName,
          institutionName,
          reference,
          courseName,
        }),
      });
    }
    return { received: true, reference };
  }
}
