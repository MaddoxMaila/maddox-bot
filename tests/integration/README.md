# tests/integration

Cross-package integration tests that don't naturally belong to a single package (e.g. queue ↔
database, or event ingestion ↔ webhook fixtures). Package-local integration tests (e.g.
`packages/database`'s repository-class tests against the compose Postgres) live alongside their
package instead, per "colocate a unit with its tests" — this directory is for tests that span more
than one package.
