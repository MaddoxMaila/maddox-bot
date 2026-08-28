# @maddox-bot/llm

An `LLMProvider` interface (`generate`, `stream`, `toolCall`, `structuredOutput`) with one
implementation, `AnthropicProvider`, defaulting every concern to `claude-opus-5` — never downgrade
for cost without being asked (see ADR-0001).

## Design

Mirrors `@maddox-bot/github`/`@maddox-bot/jira`'s shape: `AnthropicProvider` depends on the narrow
`AnthropicClientLike` interface, not the real `@anthropic-ai/sdk` client directly, so its tests pass
plain mocked functions. `createAnthropicAdapter` is the one file that touches the real SDK
(`messages.create` / `.stream` / `.parse`); `AnthropicProvider` translates between this package's
own types (`ConversationMessage`, `ToolDefinition`, ...) and the SDK's real request/response shapes
via the pure functions in `converters.ts`.

```
createAnthropicProvider(apiKey) → AnthropicProvider(createAnthropicAdapter(apiKey))
```

## `toolCall` vs `generate`

The real Messages API has no separate tool-calling endpoint — `tools` is just a parameter on the
same `messages.create` call. `toolCall()` exists as its own method (matching spec §29's named
interface) because it makes `tools` required and gives a place to default `toolChoice`; internally
it's the same request shape as `generate()` plus `tools`/`tool_choice`.

## Structured outputs

`structuredOutput()` uses `client.messages.parse()` with `zodOutputFormat(schema)` (the SDK's
schema-validating helper) rather than asking the model to emit JSON and parsing it by hand.
`result.value` is `null` when parsing failed — this package never fabricates a value to satisfy the
type; the caller decides what "no valid plan" means for its own flow. This is also why the design
uses a **manual** agent loop rather than the SDK's beta Tool Runner (see ADR-0001): the loop needs
to persist state after every call and resume a crashed worker from Postgres, which owning the loop
makes possible.

## Prompt caching

Given a `system` prompt, it's wrapped as `[{ type: "text", text, cache_control: { type: "ephemeral" } }]`
— caching the stable system prompt (and any tool schemas, which render immediately after `system`
in the request) so repeated calls with the same prompt only pay full price once. Caching is a
**prefix match**: callers should keep the system text stable per concern rather than interpolating
per-request values into it, or every call misses the cache.

## Model selection

`ModelRouter.modelFor(concern)` picks a model for one of `planning` / `implementation` /
`codeReview` / `summarization` / `classification`, defaulting all of them to `claude-opus-5` unless
explicitly overridden. Every request type accepts an optional `model` field — how a router's
selection actually reaches a call — so one `AnthropicProvider` instance serves every concern.

## What this increment does _not_ need

No live Anthropic credentials — every test here mocks the SDK client. An `ANTHROPIC_API_KEY` is
needed only for an optional live smoke test against the real API, which hasn't been added yet
(nothing in Phase 1 depends on it existing) — add one when a key is available, per the plan's own
scoping for this increment.
