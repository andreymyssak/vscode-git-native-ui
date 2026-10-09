const { readFileSync } = require('node:fs');
const preparation = require('./.release-it.json');

module.exports = {
  ...preparation,
  git: {
    ...preparation.git,
    requireBranch: 'main',
    requireUpstream: true,
    tag: true,
    push: true,
  },
  plugins: { '@release-it/conventional-changelog': false },
  hooks: { 'before:git:release': 'npm run release:validate' },
  github: {
    release: true,
    assets: ['.artifacts/git-native-ui.vsix'],
    releaseNotes: ({ version }) => {
      const section = readFileSync('CHANGELOG.md', 'utf8')
        .split(/^#{1,2} /m)
        .find(
          (entry) =>
            entry.startsWith(`[${version}]`) ||
            entry.startsWith(`${version} `) ||
            entry.startsWith(`${version}\n`),
        );

      if (!section) throw new Error(`Missing release notes for ${version}.`);

      const notes = section.split('\n').slice(1).join('\n').trim();

      if (!notes) throw new Error(`Empty release notes for ${version}.`);

      return notes;
    },
  },
};
