import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isRecord } from '../shared/validation.ts';

const labels = {
  success: 'Passed',
  failure: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

function checkStatus(value: unknown): keyof typeof labels {
  switch (value) {
    case 'success':
    case 'failure':
    case 'cancelled':
    case 'skipped':
      return value;
    default:
      throw new Error('Invalid check status');
  }
}

function parseChecks(value: unknown) {
  assert.ok(Array.isArray(value) && value.length > 0, 'Missing check results');

  return value.map((item: unknown) => {
    assert.ok(isRecord(item), 'Invalid check result');
    assert.ok(
      typeof item.name === 'string' && item.name.trim(),
      'Missing check name',
    );

    return { name: item.name, status: checkStatus(item.status) };
  });
}

function cell(value: string) {
  return value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

export function checkSummary({
  title,
  results,
  runUrl,
}: {
  title: string;
  results: unknown;
  runUrl: string;
}) {
  const checks = parseChecks(results);
  const status =
    checks.find((check) => check.status === 'failure')?.status ??
    checks.find((check) => check.status === 'cancelled')?.status ??
    checks.find((check) => check.status === 'skipped')?.status ??
    'success';
  const overall = status === 'skipped' ? 'Incomplete' : labels[status];
  const rows = checks.map(
    (check) => `| ${cell(check.name)} | ${labels[check.status]} |`,
  );

  return {
    status,
    markdown: [
      `## ${cell(title)}`,
      '',
      `**Overall: ${overall}**`,
      '',
      '| Check | Result |',
      '| --- | --- |',
      ...rows,
      '',
      `[View jobs, logs and artifacts](${runUrl})`,
      '',
    ].join('\n'),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const results: unknown = JSON.parse(process.env.CHECK_RESULTS ?? 'null');
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const summary = checkSummary({
    title: process.env.CHECK_TITLE ?? 'Extension checks',
    results,
    runUrl,
  });
  const path = process.env.GITHUB_STEP_SUMMARY;

  assert.ok(path, 'Missing GitHub check summary path');
  await appendFile(path, summary.markdown);
  process.exitCode = summary.status === 'success' ? 0 : 1;
}
