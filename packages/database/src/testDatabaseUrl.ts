// Integration tests need a live Postgres. Default to this repo's docker-compose instance
// (see docker-compose.yml / .env.example) so `pnpm test` works without extra setup as long as
// `docker compose up -d` has been run; an explicit DATABASE_URL always wins.
export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://maddox:maddox@localhost:5433/maddox_bot";
}
