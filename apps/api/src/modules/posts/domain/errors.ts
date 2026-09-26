import { POST_ERROR_CODES as c } from '@emis/contracts';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

export const postErrors = {
  notFound: () => new NotFoundException({ code: c.postNotFound, message: 'Post not found.' }),
  publishRestricted: () =>
    new ForbiddenException({
      code: c.publishRestricted,
      message:
        'Only someone who can publish may change or remove a post that is live or scheduled.',
    }),
};
