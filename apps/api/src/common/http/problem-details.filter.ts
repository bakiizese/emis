import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { toProblemDetails } from './problem-details.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Global filter: every error response is `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ProblemDetailsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = toProblemDetails(exception);
    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, 'request failed');
    }

    void reply
      .status(problem.status)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send({ ...problem, instance: request.url.split('?')[0], requestId: request.id });
  }
}
