import type { JiraTriggerConfig } from "./jiraEvents.js";

/** Safely narrows a repository's stored `agentTriggerConfig` JSON blob into a JiraTriggerConfig. */
export function parseJiraTriggerConfig(raw: unknown): JiraTriggerConfig {
  if (raw === null || typeof raw !== "object") {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const config: JiraTriggerConfig = {};
  if (typeof obj.triggerStatus === "string") {
    config.triggerStatus = obj.triggerStatus;
  }
  if (typeof obj.triggerLabel === "string") {
    config.triggerLabel = obj.triggerLabel;
  }
  if (typeof obj.aiAssigneeAccountId === "string") {
    config.aiAssigneeAccountId = obj.aiAssigneeAccountId;
  }
  return config;
}
