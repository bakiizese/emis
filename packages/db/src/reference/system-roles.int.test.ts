import { SYSTEM_ROLES } from '@emis/permissions';
import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';

import { syncSystemRoles } from './system-roles.js';

const urls = inject('database');

async function query<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: urls.migratorUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

describe('syncSystemRoles', () => {
  it('matches the code definitions and heals drift', async () => {
    // Simulate drift: a stray permission on Secretary and a renamed Admin.
    await query(`INSERT INTO role_permissions (role_id, permission)
                 SELECT id, 'audit.read' FROM roles WHERE key = 'secretary'`);
    await query(`UPDATE roles SET name = 'Boss' WHERE key = 'admin'`);

    await syncSystemRoles(urls.migratorUrl);
    await syncSystemRoles(urls.migratorUrl); // idempotent

    const rows = await query<{ key: string; name: string; permissions: string[] | null }>(`
      SELECT r.key, r.name, array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL) AS permissions
      FROM roles r LEFT JOIN role_permissions p ON p.role_id = r.id
      WHERE r.is_system GROUP BY r.key, r.name ORDER BY r.key`);

    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      const row = rows.find((r) => r.key === key);
      expect(row?.name).toBe(role.name);
      expect(row?.permissions ?? []).toEqual([...role.permissions].sort());
    }
  });
});
