import { isRecord } from '../shared/validation.ts';
import type {
  ChangeDisposition,
  ManifestInput,
  ManifestOutput,
  ManifestPatch,
  ReleaseNotes,
  ReviewedChange,
  ReviewedReport,
  Sha256,
  UpstreamManifest,
  UpstreamRevision,
  WatchedInput,
} from './types.ts';

function record(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(context);

  return value;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new Error(context);

  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(context);

  return value;
}

function isRevision(value: unknown): value is UpstreamRevision {
  return typeof value === 'string' && /^[a-f\d]{40}$/i.test(value);
}

export function parseRevision(value: unknown): UpstreamRevision {
  if (!isRevision(value))
    throw new Error('Supply an explicit full upstream commit revision.');

  return value;
}

function isSha256(value: unknown): value is Sha256 {
  return typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
}

export function parseSha256(value: unknown): Sha256 {
  if (!isSha256(value)) throw new Error('Invalid SHA-256 hash.');

  return value;
}

export function parseRepository(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(value))
    throw new Error('Invalid source repository.');

  return value;
}

const manifestError = 'Unsupported upstream manifest';

function source(value: unknown) {
  const input = record(value, manifestError);
  const parsed = {
    ...input,
    path: string(input.path, manifestError),
    revision: parseRevision(input.revision),
    sha256: parseSha256(input.sha256),
  };

  if (input.repository === undefined) return parsed;

  return {
    ...parsed,
    repository:
      input.repository === null ? null : parseRepository(input.repository),
  };
}

function manifestInput(value: unknown): ManifestInput {
  const input = record(value, manifestError);

  return {
    ...source(input),
    localPath: string(input.localPath, manifestError),
    role: string(input.role, manifestError),
  };
}

function watchedInput(value: unknown): WatchedInput {
  const input = record(value, manifestError);
  const parsed: WatchedInput = {
    ...source(input),
    category: string(input.category, manifestError),
  };

  if (input.localPath !== undefined)
    parsed.localPath =
      input.localPath === null ? null : string(input.localPath, manifestError);

  return parsed;
}

function manifestPatch(value: unknown): ManifestPatch {
  const patch = record(value, manifestError);

  return {
    ...patch,
    path: string(patch.path, manifestError),
    sha256: parseSha256(patch.sha256),
  };
}

function manifestOutput(value: unknown): ManifestOutput {
  const output = record(value, manifestError);

  return {
    ...output,
    path: string(output.path, manifestError),
    sourcePath: string(output.sourcePath, manifestError),
  };
}

function releaseNotes(value: unknown): ReleaseNotes {
  const notes = record(value, manifestError);

  return {
    ...notes,
    url: string(notes.url, manifestError),
    revision: parseRevision(notes.revision),
    sha256: parseSha256(notes.sha256),
  };
}

export function parseManifest(value: unknown): UpstreamManifest {
  const manifest = record(value, manifestError);
  const parsed: UpstreamManifest = {
    ...manifest,
    repository: parseRepository(manifest.repository),
    inputs: array(manifest.inputs, manifestError).map(manifestInput),
    patches: array(manifest.patches, manifestError).map(manifestPatch),
    outputs: array(manifest.outputs, manifestError).map(manifestOutput),
  };

  if (manifest.adoptedRevision !== undefined)
    parsed.adoptedRevision = parseRevision(manifest.adoptedRevision);
  if (manifest.lastReviewedRevision !== undefined)
    parsed.lastReviewedRevision =
      manifest.lastReviewedRevision === null
        ? null
        : parseRevision(manifest.lastReviewedRevision);
  if (manifest.watched !== undefined)
    parsed.watched =
      manifest.watched === null
        ? null
        : array(manifest.watched, manifestError).map(watchedInput);
  if (manifest.releaseNotes !== undefined)
    parsed.releaseNotes =
      manifest.releaseNotes === null
        ? null
        : releaseNotes(manifest.releaseNotes);

  return parsed;
}

export function parseTreePaths(value: unknown): string[] {
  const tree = record(value, 'Invalid upstream tree listing.');

  if (typeof tree.truncated !== 'boolean')
    throw new Error('Invalid upstream tree listing.');
  if (tree.truncated)
    throw new Error(
      'Upstream tree listing was truncated. Review possible moves manually.',
    );

  return array(tree.tree, 'Invalid upstream tree listing.').flatMap((value) => {
    const item = record(value, 'Invalid upstream tree item.');
    const type = string(item.type, 'Invalid upstream tree item type.');

    return type === 'blob'
      ? [string(item.path, 'Invalid upstream tree item path.')]
      : [];
  });
}

export function parseDisposition(value: unknown): ChangeDisposition {
  const disposition = record(value, 'Choose a supported change disposition.');

  switch (disposition.type) {
    case 'already supplied by installed API':
    case 'integration required':
    case 'source adaptation required':
    case 'not applicable':
      return { ...disposition, type: disposition.type };
    case 'deferred': {
      const message = 'Deferral requires a reason and revisit condition.';
      const reason = string(disposition.reason, message);
      const revisit = string(disposition.revisit, message);

      if (!reason.trim() || !revisit.trim()) throw new Error(message);

      return { ...disposition, type: 'deferred', reason, revisit };
    }

    default:
      throw new Error('Choose a supported change disposition.');
  }
}

export function parseReview(value: unknown): ReviewedReport {
  const message = 'Cannot approve a failed or invalid source report.';
  const report = record(value, message);

  if (report.status !== 'changes' && report.status !== 'no-changes')
    throw new Error(message);
  if (
    report.failures !== undefined &&
    array(report.failures, message).length !== 0
  )
    throw new Error(message);
  const targetRevision = parseRevision(report.targetRevision);
  const changes = array(report.changes, 'Missing reviewed changes.').map(
    (value): ReviewedChange => {
      const change = record(value, message);
      const path = string(change.path, message);

      switch (change.state) {
        case 'failed':
          throw new Error(`Failed source check: ${path}`);
        case 'changed':
        case 'missing':
          if (!change.disposition)
            throw new Error(`Missing disposition: ${path}`);

          return {
            ...change,
            path,
            state: change.state,
            disposition: parseDisposition(change.disposition),
          };
        case 'unchanged':
          return { ...change, path, state: 'unchanged' };
        default:
          throw new Error(message);
      }
    },
  );

  return { ...report, status: report.status, targetRevision, changes };
}
