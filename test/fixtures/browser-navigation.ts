import { setTimeout } from 'node:timers/promises';

export async function recoverBrowserNavigation<T>({
  navigate,
  report,
}: {
  navigate(this: void): Promise<T>;
  report(this: void, error: Error): void;
}): Promise<T> {
  try {
    return await navigate();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('net::ERR_NO_BUFFER_SPACE')
    )
      throw error;
    report(error);
    await setTimeout(100);

    return navigate();
  }
}
