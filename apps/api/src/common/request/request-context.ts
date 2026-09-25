import type { ClsStore } from 'nestjs-cls';

/** Who is calling and from where, for the lifetime of one request (set by the AuthGuard). */
export interface RequestMeta {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface Actor {
  userId: string;
  email: string;
  sessionId: string;
}

export interface AppClsStore extends ClsStore {
  request?: RequestMeta;
  actor?: Actor;
}
