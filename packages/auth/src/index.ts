import { createHash, randomBytes } from "crypto";
import type { DbClient } from "@cortera/core";

export interface ApiKey {
  id: string;
  actorId: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface CreateApiKeyResult {
  key: string;
  keyId: string;
}

export interface ValidateApiKeyResult {
  actorId: string;
  workspaceId: string;
  keyId: string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  const prefix = "cortera_";
  const randomPart = randomBytes(32).toString("base64url");
  return `${prefix}${randomPart}`;
}

export async function createApiKey(
  dbClient: DbClient,
  actorId: string,
  workspaceId: string,
  name: string
): Promise<CreateApiKeyResult> {
  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);

  await dbClient.query(
    `INSERT INTO api_keys (key_hash, actor_id, workspace_id, name)
     VALUES ($1, $2, $3, $4)`,
    [keyHash, actorId, workspaceId, name]
  );

  const { rows } = await dbClient.query(
    `SELECT id FROM api_keys WHERE key_hash = $1`,
    [keyHash]
  );

  return { key: rawKey, keyId: rows[0].id };
}

export async function validateApiKey(
  dbClient: DbClient,
  rawKey: string
): Promise<ValidateApiKeyResult | null> {
  const keyHash = hashKey(rawKey);

  const { rows } = await dbClient.query(
    `SELECT id, actor_id, workspace_id, revoked_at
     FROM api_keys
     WHERE key_hash = $1`,
    [keyHash]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  if (row.revoked_at !== null) {
    return null;
  }

  await dbClient.query(
    `UPDATE api_keys SET last_used_at = now() WHERE id = $1`,
    [row.id]
  );

  return {
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    keyId: row.id,
  };
}

export async function revokeApiKey(
  dbClient: DbClient,
  keyId: string
): Promise<void> {
  await dbClient.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1`,
    [keyId]
  );
}

export async function listApiKeys(
  dbClient: DbClient,
  workspaceId: string
): Promise<ApiKey[]> {
  const { rows } = await dbClient.query(
    `SELECT id, actor_id, workspace_id, name, created_at, revoked_at, last_used_at
     FROM api_keys
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId]
  );

  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  }));
}