import type { Reference, RepositoryInfo } from '@contracts/model';

export interface ReferenceLabel {
  name: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
}
export const descriptions = {
  head: 'Current checkout',
  local: 'Local branch',
  remote: 'Remote-tracking branch',
  tag: 'Tag',
};
const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function buildReferenceLabels(
  references: readonly Reference[],
  repository: RepositoryInfo | null,
  sha: string,
): {
  labels: ReferenceLabel[];
  markers: ReferenceLabel[];
  summary: string;
  accessibleLabel: string;
} {
  const current = sha === repository?.headSha;
  const priority = (ref: Reference) =>
    ref.kind === 'local' && ref.name === repository?.branch
      ? 0
      : { local: 1, remote: 2, tag: 3 }[ref.kind];
  const refs = [...references].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      names.compare(a.name, b.name) ||
      a.id.localeCompare(b.id, 'en'),
  );
  const labels: ReferenceLabel[] = [
    ...(current ? [{ name: 'HEAD', kind: 'head' as const }] : []),
    ...refs,
  ];
  const types = new Set<ReferenceLabel['kind']>();
  const representatives = labels.filter((label) => {
    if (types.has(label.kind)) return false;
    types.add(label.kind);

    return true;
  });

  return {
    labels,
    markers: [
      ...representatives,
      ...labels.filter((label) => !representatives.includes(label)),
    ].slice(0, 3),
    summary: refs[0]?.name ?? 'HEAD',
    accessibleLabel: [
      ...(current ? ['HEAD'] : []),
      ...refs.map((ref) => descriptions[ref.kind] + ': ' + ref.name),
    ].join('\n'),
  };
}
