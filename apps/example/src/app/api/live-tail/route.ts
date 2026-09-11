import { Pool } from "pg";
import { createLiveTailHandler } from "@tera/adapter-next";

const dbUrl =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/tera";

const pool = new Pool({ connectionString: dbUrl });

const liveTailHandler = createLiveTailHandler({ pool });

export async function GET(request: Request) {
  const nextRequest = request as unknown as Parameters<typeof liveTailHandler>[0];
  return liveTailHandler(nextRequest, { params: {} } as Parameters<typeof liveTailHandler>[1]);
}
