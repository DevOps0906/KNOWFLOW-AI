import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { assertSafeToReset } from "./safe-reset";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, "../bootstrap.sql");
const migrationsDir = path.resolve(here, "../../../supabase/migrations");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const RESET_SQL = `
drop schema if exists public, auth, storage, extensions cascade;
create schema public authorization pg_database_owner;
grant usage on schema public to public;
`;

async function applySql(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(RESET_SQL);
    await client.query(fs.readFileSync(bootstrapPath, "utf8"));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, f), "utf8"));
      } catch (e) {
        throw new Error(`마이그레이션 적용 실패: ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    assertSafeToReset(external, process.env.DB_TESTS_ALLOW_RESET);
    await applySql(external);
    project.provide("dbUrl", external);
    return;
  }

  // 저장소 밖 임시 폴더에 실제 Postgres 서버를 띄운다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowflow-dbtests-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: path.join(dir, "data"),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "max_connections=200"],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  try {
    await applySql(url);
  } catch (e) {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  project.provide("dbUrl", url);
  return async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
