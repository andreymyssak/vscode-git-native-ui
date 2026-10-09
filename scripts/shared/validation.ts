export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasErrorCode(value: unknown, code: string | number): boolean {
  return isRecord(value) && value.code === code;
}
