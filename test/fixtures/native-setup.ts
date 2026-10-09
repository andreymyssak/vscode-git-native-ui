import { nativeBrowser } from './native-panel';

export async function mochaGlobalSetup(): Promise<void> {
  // Attach before tests create webviews so CDP observes their nested frames.
  await nativeBrowser();
}
