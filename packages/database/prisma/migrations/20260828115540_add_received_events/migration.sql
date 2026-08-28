-- CreateTable
CREATE TABLE "received_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "organization_id" TEXT,
    "repository_id" TEXT,
    "is_relevant" BOOLEAN NOT NULL,
    "relevance_reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "received_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "received_events_source_source_event_id_key" ON "received_events"("source", "source_event_id");
