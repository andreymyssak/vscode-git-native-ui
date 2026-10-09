import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { githubTransport, hash, reportChanges } from './report.ts';
import { loadManifest, reproduce, safePath } from './reproduce.ts';
import type { ReportOptions, UpstreamTransport } from './types.ts';
import { parseRevision } from './validation.ts';

export async function prepareUpdate(
  manifestPath: string,
  targetRevision: string,
  outputRoot: string,
  transport: UpstreamTransport = githubTransport,
  options: ReportOptions = {},
): Promise<void> {
  const { manifest, root } = await loadManifest(manifestPath);
  const out = resolve(outputRoot);

  if (
    out === root ||
    root.startsWith(out + sep) ||
    (out.startsWith(root + sep) &&
      !out.startsWith(resolve(root, '.artifacts') + sep))
  )
    throw new Error(
      'Prepare in an owned .artifacts directory or outside the live repository.',
    );
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length)
    throw new Error('Preparation requires an empty output directory.');
  try {
    const report = await reportChanges(
      manifestPath,
      targetRevision,
      transport,
      options,
    );

    await writeFile(
      safePath(out, 'change-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    if (report.status === 'failed')
      throw new Error('Source report failed; no adoption is prepared.');
    const candidate = structuredClone(manifest);

    candidate.adoptedRevision = report.targetRevision;
    for (const input of candidate.inputs) {
      const data = await transport.file(
        candidate.repository,
        targetRevision,
        input.path,
      );

      if (data === null)
        throw new Error(
          `Missing input ${input.path}; review possible moves before adapting.`,
        );
      input.sha256 = hash(data);
      input.revision = report.targetRevision;
      const target = safePath(out, input.localPath);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }

    for (const patch of candidate.patches) {
      const target = safePath(out, patch.path);

      await mkdir(dirname(target), { recursive: true });
      await copyFile(safePath(root, patch.path), target);
    }

    for (const watched of candidate.watched ?? []) {
      const data = await transport.file(
        watched.repository ?? candidate.repository,
        targetRevision,
        watched.path,
      );

      if (data === null)
        throw new Error(`Missing watched input ${watched.path}`);
      watched.sha256 = hash(data);
      watched.revision = report.targetRevision;
    }

    if (candidate.releaseNotes) {
      const notes = report.changes.find(
        (change) => change.category === 'release-notes',
      );

      if (!notes || notes.newHash === null)
        throw new Error('Release-notes report has no verified hash.');
      candidate.releaseNotes = {
        ...candidate.releaseNotes,
        url: notes.path,
        sha256: notes.newHash,
        revision: report.targetRevision,
      };
    }

    const prepared = safePath(out, 'upstream/vscode/manifest.json');

    await mkdir(dirname(prepared), { recursive: true });
    await writeFile(prepared, JSON.stringify(candidate, null, 2) + '\n');
    const reproduced = safePath(out, '.artifacts/reproduced');

    await reproduce(prepared, reproduced);
    for (const output of candidate.outputs) {
      const target = safePath(out, output.path);

      await mkdir(dirname(target), { recursive: true });
      await copyFile(safePath(reproduced, output.path), target);
    }

    await writeFile(
      safePath(out, 'preparation.json'),
      JSON.stringify(
        { status: 'prepared', targetRevision, reviewRequired: true },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    await writeFile(
      safePath(out, 'preparation.json'),
      JSON.stringify(
        { status: 'failed', targetRevision, error: String(error) },
        null,
        2,
      ) + '\n',
    );
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [revision, out, ...args] = process.argv.slice(2);
  const target = parseRevision(revision);
  const notes = args.indexOf('--notes-url');
  const releaseNotesUrl = notes < 0 ? undefined : args[notes + 1];

  await prepareUpdate(
    resolve('upstream/vscode/manifest.json'),
    target,
    resolve(out ?? `.artifacts/upstream-update-${target.slice(0, 12)}`),
    githubTransport,
    releaseNotesUrl === undefined ? {} : { releaseNotesUrl },
  );
  console.log(
    'Update prepared separately. Review conflicts/dispositions, run checks and adopt explicitly.',
  );
}
