export type UpstreamRevision = string & {
  readonly __brand: 'UpstreamRevision';
};

export type Sha256 = string & { readonly __brand: 'Sha256' };

interface SourceInput {
  path: string;
  repository?: string | null;
  revision: UpstreamRevision;
  sha256: Sha256;
}

export interface ManifestInput extends SourceInput {
  localPath: string;
  role: string;
}

export interface WatchedInput extends SourceInput {
  category: string;
  localPath?: string | null;
}

export interface ManifestPatch {
  path: string;
  sha256: Sha256;
}

export interface ManifestOutput {
  sourcePath: string;
  path: string;
}

export interface ReleaseNotes {
  url: string;
  revision: UpstreamRevision;
  sha256: Sha256;
}

export interface UpstreamManifest {
  repository: string;
  adoptedRevision?: UpstreamRevision;
  lastReviewedRevision?: UpstreamRevision | null;
  inputs: ManifestInput[];
  patches: ManifestPatch[];
  outputs: ManifestOutput[];
  watched?: WatchedInput[] | null;
  releaseNotes?: ReleaseNotes | null;
}

export interface UpstreamTransport {
  file(
    repository: string,
    revision: string,
    path: string,
  ): Promise<Buffer | null>;
  tree(repository: string, revision: string): Promise<string[]>;
  notes?(url: string): Promise<Buffer>;
}

export interface ReportOptions {
  releaseNotesUrl?: string;
}

export type ChangeDisposition =
  | {
      type:
        | 'already supplied by installed API'
        | 'integration required'
        | 'source adaptation required'
        | 'not applicable';
    }
  | { type: 'deferred'; reason: string; revisit: string };

interface ChangeDetails {
  path: string;
  kind: 'copied' | 'watched';
  category: string;
  baselineRevision: UpstreamRevision;
  oldHash: Sha256;
  possibleMoves: string[];
  disposition: ChangeDisposition | null;
  repository?: string;
  comparisonUrl?: string;
}

export type UpstreamChange = ChangeDetails &
  (
    | { state: 'unchanged' | 'changed'; newHash: Sha256 }
    | { state: 'missing' | 'failed'; newHash: null }
  );

export interface ReportFailure {
  path: string;
  message: string;
}

export interface UpstreamReport {
  repository: string;
  targetRevision: UpstreamRevision;
  adoptedRevisions: UpstreamRevision[];
  lastReviewedRevision: UpstreamRevision | null | undefined;
  status: 'changes' | 'no-changes' | 'failed';
  changes: UpstreamChange[];
  failures: ReportFailure[];
  reviewRequired: string[];
}

export type ReviewedChange =
  | { path: string; state: 'unchanged' }
  | {
      path: string;
      state: 'changed' | 'missing';
      disposition: ChangeDisposition;
    };

export interface ReviewedReport {
  status: 'changes' | 'no-changes';
  targetRevision: UpstreamRevision;
  changes: ReviewedChange[];
}
