import { SYSTEM_ROLES, type SystemRoleKey } from '@emis/permissions';
import { and, eq, notInArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { rolePermissions, roles } from '../schema/access.js';

/**
 * Make the database match the system roles defined in @emis/permissions: create missing roles,
 * update names/flags, and add or remove permissions. Custom roles are never touched. Idempotent;
 * runs after every migration so upgrades pick up new permissions.
 */
export async function syncSystemRoles(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'emis-reference-data' });
  await client.connect();
  try {
    const db = drizzle({ client, casing: 'snake_case' });
    await db.transaction(async (tx) => {
      for (const [key, role] of Object.entries(SYSTEM_ROLES) as [
        SystemRoleKey,
        (typeof SYSTEM_ROLES)[SystemRoleKey],
      ][]) {
        const values = {
          key,
          name: role.name,
          description: role.description,
          isSystem: true,
          mfaRequired: role.mfaRequired,
          allowedScopes: [...role.allowedScopes],
        };
        const [row] = await tx
          .insert(roles)
          .values(values)
          .onConflictDoUpdate({ target: roles.key, set: { ...values, updatedAt: new Date() } })
          .returning({ id: roles.id });
        if (!row) throw new Error(`Could not upsert role ${key}`);

        const permissions = [...role.permissions];
        if (permissions.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(permissions.map((permission) => ({ roleId: row.id, permission })))
            .onConflictDoNothing();
        }
        await tx
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, row.id),
              permissions.length > 0
                ? notInArray(rolePermissions.permission, permissions)
                : undefined,
            ),
          );
      }
      // A role that used to be a system role but no longer is stays, as a custom role.
      await tx
        .update(roles)
        .set({ isSystem: false })
        .where(and(eq(roles.isSystem, true), notInArray(roles.key, Object.keys(SYSTEM_ROLES))));
    });
  } finally {
    await client.end();
  }
}
