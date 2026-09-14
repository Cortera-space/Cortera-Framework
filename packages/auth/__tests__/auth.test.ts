import { describe, it, expect, beforeEach } from "vitest";
import { PostgresDbClient } from "@tera/db";
import { createApiKey, validateApiKey, revokeApiKey, listApiKeys } from "@tera/auth";
import { createHash } from "crypto";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/tera_test";

describe("auth", () => {
  let dbClient: PostgresDbClient;

  beforeEach(async () => {
    dbClient = new PostgresDbClient({ connectionString: TEST_DB_URL });
    // Clean up test data
    await dbClient.query(`DELETE FROM api_keys WHERE workspace_id = 'test-workspace'`);
  });

  it("createApiKey generates a valid key and stores only its hash", async () => {
    const result = await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key");
    
    expect(result.key).toBeDefined();
    expect(result.key).toMatch(/^tera_/);
    expect(result.keyId).toBeDefined();
    
    // Verify the key is stored as a hash
    const keyHash = createHash("sha256").update(result.key).digest("hex");
    const { rows } = await dbClient.query(
      `SELECT key_hash FROM api_keys WHERE id = $1`,
      [result.keyId]
    );
    expect(rows[0].key_hash).toBe(keyHash);
  });

  it("validateApiKey correctly resolves valid keys", async () => {
    const createResult = await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key");
    
    const validation = await validateApiKey(dbClient, createResult.key);
    
    expect(validation).not.toBeNull();
    expect(validation?.actorId).toBe("test-actor");
    expect(validation?.workspaceId).toBe("test-workspace");
    expect(validation?.keyId).toBe(createResult.keyId);
  });

  it("validateApiKey rejects invalid keys", async () => {
    const validation = await validateApiKey(dbClient, "tera_invalid_key");
    expect(validation).toBeNull();
  });

  it("validateApiKey rejects revoked keys", async () => {
    const createResult = await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key");
    await revokeApiKey(dbClient, createResult.keyId);
    
    const validation = await validateApiKey(dbClient, createResult.key);
    expect(validation).toBeNull();
  });

  it("revokeApiKey causes subsequent validateApiKey calls to fail", async () => {
    const createResult = await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key");
    
    // Key should work before revocation
    let validation = await validateApiKey(dbClient, createResult.key);
    expect(validation).not.toBeNull();
    
    // Revoke the key
    await revokeApiKey(dbClient, createResult.keyId);
    
    // Key should not work after revocation
    validation = await validateApiKey(dbClient, createResult.key);
    expect(validation).toBeNull();
  });

  it("listApiKeys never exposes the raw key or hash", async () => {
    await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key 1");
    await createApiKey(dbClient, "test-actor", "test-workspace", "Test Key 2");
    
    const keys = await listApiKeys(dbClient, "test-workspace");
    
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key.id).toBeDefined();
      expect(key.actorId).toBe("test-actor");
      expect(key.workspaceId).toBe("test-workspace");
      expect(key.name).toBeDefined();
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.revokedAt).toBeNull();
      expect(key.lastUsedAt).toBeNull();
      // Should not have key_hash or raw key
      expect((key as any).key_hash).toBeUndefined();
      expect((key as any).key).toBeUndefined();
    }
  });

  it("listApiKeys returns keys sorted by created_at DESC", async () => {
    await createApiKey(dbClient, "test-actor", "test-workspace", "First Key");
    await new Promise(resolve => setTimeout(resolve, 10));
    await createApiKey(dbClient, "test-actor", "test-workspace", "Second Key");
    
    const keys = await listApiKeys(dbClient, "test-workspace");
    
    expect(keys[0].name).toBe("Second Key");
    expect(keys[1].name).toBe("First Key");
  });
});