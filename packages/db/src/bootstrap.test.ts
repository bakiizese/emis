import { describe, expect, it } from 'vitest';

import { parseConnectionUrl } from './bootstrap.js';

describe('parseConnectionUrl', () => {
  it('extracts and decodes credentials and database', () => {
    expect(parseConnectionUrl('postgres://emis_app:p%40ss%2Fword@localhost:5433/emis')).toEqual({
      user: 'emis_app',
      password: 'p@ss/word',
      database: 'emis',
    });
  });

  it('rejects URLs without a password or database', () => {
    expect(() => parseConnectionUrl('postgres://emis_app@localhost:5433/emis')).toThrow();
    expect(() => parseConnectionUrl('postgres://emis_app:pw@localhost:5433')).toThrow();
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseConnectionUrl('mysql://u:p@localhost/db')).toThrow(/postgres/);
  });
});
