export class GitPartialCompletion extends Error {
  constructor(completed: string, failed: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);

    super(`${completed} ${failed} ${detail}`, { cause });
  }
}
