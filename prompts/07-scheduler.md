$worktreeos-milestone Execute milestone 07 - Reliable bounded scheduler.

Add a persistent queue with configurable total concurrency max 2 and max 1 active writer per worktree; implement per-repository locks for Git operations, cancellation, timeouts, retries only after explicit action, interrupt reconciliation after API restart (mark prior running work interrupted, never auto-reexecute real agent). Stream status updates, retain event history, and use clean provider cancellation when available. Block duplicate task execution, preserve diffs, handle process exit, and avoid leaked worktrees.

Acceptance: tests prove two separate repos may run mock tasks concurrently, one worktree cannot be written simultaneously, cancellation and restart recovery are safe. Verify Windows-compatible process cleanup. Update docs.
