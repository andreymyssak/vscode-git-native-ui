import { assert, expect, test } from 'vitest';

import type { SquashRuntime } from '../../src/extension/git/squash-editor';
import { createSquashEditors } from '../../src/extension/git/squash-editor';

test('trusted Windows paths are normalized and relative or NUL command inputs reject', () => {
  const runtime: SquashRuntime = {
    executable: 'C:\\Program Files\\VS Code\\Code.exe',
    helperPath: "C:\\Users\\O'Brien ü\\squash-helper.cjs",
  };
  const editors = createSquashEditors(
    runtime,
    'C:\\Private Inputs\\approved.json',
  );

  assert.ok(
    editors.GIT_EDITOR.startsWith(
      "ELECTRON_RUN_AS_NODE=1 'C:/Program Files/VS Code/Code.exe'",
    ),
  );
  assert.ok(editors.GIT_EDITOR.includes("O'\"'\"'Brien ü/squash-helper.cjs"));
  assert.ok(
    editors.GIT_SEQUENCE_EDITOR.includes("'C:/Private Inputs/approved.json'"),
  );
  for (const [candidate, input] of [
    [{ ...runtime, executable: 'node --eval malicious' }, 'C:/private/input'],
    [{ ...runtime, helperPath: 'helper.cjs' }, 'C:/private/input'],
    [runtime, 'relative.json'],
    [runtime, 'C:/private/\0input'],
  ] as const) {
    expect(() => createSquashEditors(candidate, input)).toThrow(
      /absolute|path|NUL/i,
    );
  }
});
