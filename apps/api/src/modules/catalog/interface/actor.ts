import type { Actor } from '../../../common/request/request-context.js';
import type { AuthContext } from '../../identity/index.js';

export const actorOf = (auth: AuthContext): Actor => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});
