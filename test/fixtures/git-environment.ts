export function gitFixtureEnvironment(
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.toUpperCase().startsWith('GIT_'),
      ),
    ),
    ...overrides,
  };
}
