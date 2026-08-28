import {
  evaluateGitHubRelevance,
  normalizeGitHubEvent,
  type GitHubWebhookPayload,
} from "@maddox-bot/events";
import { verifyGitHubWebhookSignature } from "@maddox-bot/github";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

export function registerGitHubWebhookRoute(app: FastifyInstance, deps: AppDependencies): void {
  app.post("/webhooks/github", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];
    const deliveryId = request.headers["x-github-delivery"];
    const eventType = request.headers["x-github-event"];
    const rawBody =
      typeof request.rawBody === "string" ? request.rawBody : request.rawBody?.toString("utf8");

    if (typeof deliveryId !== "string" || typeof eventType !== "string" || rawBody === undefined) {
      return reply.code(400).send({ error: "missing required GitHub webhook headers or body" });
    }

    const isValid = await verifyGitHubWebhookSignature(
      deps.githubWebhookSecret,
      rawBody,
      typeof signature === "string" ? signature : undefined,
    );
    if (!isValid) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const payload = request.body as GitHubWebhookPayload;
    const event = normalizeGitHubEvent(eventType, deliveryId, payload);

    const [owner, name] = payload.repository.full_name.split("/");
    const repository =
      owner !== undefined && name !== undefined
        ? await deps.database.repositories.findByOwnerAndName(owner, name)
        : null;

    let relevance: { isRelevant: boolean; reason: string };
    if (repository === null) {
      relevance = { isRelevant: false, reason: "untracked_repository" };
    } else if (payload.pull_request) {
      const trackedPullRequest = await deps.database.pullRequests.findByRepositoryAndProviderNumber(
        repository.id,
        payload.pull_request.number,
      );
      relevance = evaluateGitHubRelevance({ isTrackedPullRequest: trackedPullRequest !== null });
    } else {
      relevance = { isRelevant: false, reason: "no_pull_request_context" };
    }

    const receivedEvent = await deps.database.receivedEvents.createIfNew({
      source: "github",
      sourceEventId: event.sourceEventId,
      eventType: event.eventType,
      ...(repository !== null && {
        organizationId: repository.organizationId,
        repositoryId: repository.id,
      }),
      isRelevant: relevance.isRelevant,
      relevanceReason: relevance.reason,
      payload: event.payload,
    });

    if (receivedEvent === null) {
      deps.logger.info({ dedupeKey: event.dedupeKey }, "duplicate GitHub webhook delivery ignored");
      return reply.code(200).send({ status: "duplicate" });
    }

    if (relevance.isRelevant && repository !== null) {
      await deps.agentTriggerQueue.enqueue(
        {
          source: "github",
          repositoryId: repository.id,
          eventType: event.eventType,
          externalRefs: event.externalRefs,
          receivedEventId: receivedEvent.id,
        },
        { jobId: event.dedupeKey },
      );
    }

    return reply.code(200).send({ status: "accepted", relevant: relevance.isRelevant });
  });
}
