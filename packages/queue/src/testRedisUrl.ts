// Mirrors packages/database/src/testDatabaseUrl.ts: default to this repo's docker-compose Redis
// instance so integration tests work out of the box once `docker compose up -d` has been run.
export function testRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6380";
}
