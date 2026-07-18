import "server-only";

import postgres, { type Sql, type TransactionSql } from "postgres";

import { requireEnv } from "@/lib/env";

export type RuntimeDatabaseRole = "admin" | "customer" | "identity" | "service";

const clients: Partial<Record<RuntimeDatabaseRole, Sql>> = {};

const databaseEnvironment: Record<RuntimeDatabaseRole, string> = {
  admin: "ADMIN_DATABASE_URL",
  customer: "CUSTOMER_DATABASE_URL",
  identity: "IDENTITY_DATABASE_URL",
  service: "SERVICE_DATABASE_URL"
};

const expectedDatabaseUser: Record<RuntimeDatabaseRole, string> = {
  admin: "pixbrik_admin_runtime",
  customer: "pixbrik_customer_runtime",
  identity: "pixbrik_identity_runtime",
  service: "pixbrik_service_runtime"
};

/** Lazily initializes PostgreSQL so `next build` never requires runtime credentials. */
function getDatabase(role: RuntimeDatabaseRole): Sql {
  const existing = clients[role];
  if (existing) return existing;

  const databaseUrl = requireEnv(databaseEnvironment[role]);
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: `pixbrik-${role}` }
  });
  clients[role] = client;
  return client;
}

export async function closeDatabase(): Promise<void> {
  const activeClients = Object.values(clients);
  for (const role of Object.keys(clients) as RuntimeDatabaseRole[]) delete clients[role];
  await Promise.all(activeClients.map((client) => client.end({ timeout: 5 })));
}

export type DatabaseRequestContext = {
  userId?: string;
};

export async function withDatabaseRole<T>(
  role: RuntimeDatabaseRole,
  operation: (transaction: TransactionSql) => Promise<T>
): Promise<T> {
  const result = await getDatabase(role).begin(async (transaction) => {
    const [identity] = await transaction<{ database_user: string; session_user: string }[]>`
      SELECT current_user::text AS database_user, session_user::text AS session_user
    `;
    if (
      identity?.database_user !== expectedDatabaseUser[role]
      || identity.session_user !== expectedDatabaseUser[role]
    ) {
      throw new Error(`Database credential does not match the requested ${role} role`);
    }
    return operation(transaction);
  });
  return result as T;
}

/**
 * Runs role-specific queries with transaction-local user context after the
 * immutable database login has been verified. Never share pools across roles.
 */
export async function withDatabaseRequestContext<T>(
  role: RuntimeDatabaseRole,
  context: DatabaseRequestContext,
  operation: (transaction: TransactionSql) => Promise<T>
): Promise<T> {
  return withDatabaseRole(role, async (transaction) => {
    await transaction`
      SELECT set_config('pixbrik.user_id', ${context.userId ?? ""}, true)
    `;
    return operation(transaction);
  });
}
