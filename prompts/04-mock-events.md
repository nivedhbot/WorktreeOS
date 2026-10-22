$worktreeos-milestone Execute milestone 04 - Mock agent execution and event streaming only.

Design AgentProvider interface with typed streaming events and MockProvider (deterministic, no APIs, clearly marked MOCK). Implement persistent run state machine (queued/preparing/running/completed/failed/canceled), append-only run events, start/cancel/retry REST actions, SSE endpoint with reconnect since event ID and heartbeat, concurrency limit 1. Start a run only from an existing task and associated safe worktree. Simulated events should include tool/progress/file actions but must not claim to be real agent output. Add tests for invalid transitions, cancellations, duplicate starts, SSE replay.

Acceptance: API can start a mock run, persist its events, stream progress and cancel/retry predictably. No external model calls. Update docs.
