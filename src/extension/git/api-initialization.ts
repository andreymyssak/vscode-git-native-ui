export interface GitApiInitialization {
  readonly state: 'uninitialized' | 'initialized';
  onDidChangeState(
    listener: (state: 'uninitialized' | 'initialized') => void,
  ): { dispose(): void };
}

export async function waitForGitInitialization(
  api: GitApiInitialization,
): Promise<void> {
  if (api.state === 'initialized') return;
  await new Promise<void>((resolve) => {
    const subscription = api.onDidChangeState((state) => {
      if (state !== 'initialized') return;
      subscription.dispose();
      resolve();
    });
  });
}
