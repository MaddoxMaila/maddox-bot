import { randomUUID } from "node:crypto";

/**
 * Attaches a nominal tag to a structural type so, e.g., a TaskId and a SessionId (both plain
 * strings at runtime) can't be passed to each other's parameters by mistake.
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };

export function createId(): string {
  return randomUUID();
}
