import {
  evaluateJiraRelevance,
  normalizeJiraEvent,
  parseJiraTriggerConfig,
  type JiraWebhookPayload,
} from "@maddox-bot/events";
import { verifyJiraWebhookToken } from "@maddox-bot/jira";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../appDependencies.js";

export function registerJiraWebhookRoute(app: FastifyInstance, deps: AppDependencies): void {
  app.post<{ Querystring: { token?: string } }>("/webhooks/jira", async (request, reply) => {
    const isValid = verifyJiraWebhookToken(deps.jiraWebhookSecret, request.query.token);
    if (!isValid) {
      return reply.code(401).send({ error: "invalid token" });
    }

    const payload = request.body as JiraWebhookPayload;
    const event = normalizeJiraEvent(payload);
    const [projectKey] = payload.issue.key.split("-");
    const repository =
      projectKey !== undefined
        ? await deps.database.repositories.findByJiraProjectKey(projectKey)
        : null;

    let relevance: { isRelevant: boolean; reason: string };
    if (repository === null) {
      relevance = { isRelevant: false, reason: "untracked_repository" };
    } else {
      relevance = evaluateJiraRelevance(
        payload,
        parseJiraTriggerConfig(repository.agentTriggerConfig),
      );
    }

    const receivedEvent = await deps.database.receivedEvents.createIfNew({
      source: "jira",
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
      deps.logger.info({ dedupeKey: event.dedupeKey }, "duplicate Jira webhook delivery ignored");
      return reply.code(200).send({ status: "duplicate" });
    }

    if (relevance.isRelevant && repository !== null) {
      await deps.agentTriggerQueue.enqueue(
        {
          source: "jira",
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
