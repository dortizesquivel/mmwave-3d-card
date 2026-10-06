// Writes the release notes for <tag> from the commits since the previous tag:
//   - release-notes.md, the body of the GitHub release
//   - a new section at the top of CHANGELOG.md
// Usage: node scripts/release-notes.mjs v0.2.0 [--dry-run]   (--dry-run only prints)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const tag = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!/^v\d+\.\d+\.\d+/.test(tag ?? '')) {
  console.error('Usage: node scripts/release-notes.mjs vX.Y.Z [--dry-run]');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let prev = '';
try { prev = git('describe', '--tags', '--abbrev=0', '--match', 'v*'); } catch { /* first release */ }

const log = git('log', '--no-merges', '--pretty=%s%x09%h', prev ? `${prev}..HEAD` : 'HEAD');
const changes = log.split('\n').filter(Boolean)
  .map((line) => line.split('\t'))
  .filter(([subject]) => !subject.startsWith('chore(release)'))
  .map(([subject, hash]) => `- ${subject} (${hash})`);
if (!changes.length) changes.push('- Maintenance release');

const repo = process.env.GITHUB_REPOSITORY ?? 'dortizesquivel/mmwave-3d-card';
const compare = prev ? `\n\n**Full changelog:** https://github.com/${repo}/compare/${prev}...${tag}` : '';
const notes = `## Changes\n\n${changes.join('\n')}${compare}\n`;

const date = new Date().toISOString().slice(0, 10);
const section = `## ${tag} - ${date}\n\n${changes.join('\n')}\n`;
const header = '# Changelog\n\n';
const previous = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8').replace(/^# Changelog\s*/, '') : '';

if (dryRun) {
  console.log(`--- release notes (${prev || 'no previous tag'} → ${tag}) ---\n${notes}`);
} else {
  writeFileSync('release-notes.md', notes);
  writeFileSync('CHANGELOG.md', `${header}${section}${previous ? `\n${previous}` : ''}`);
  console.log(notes);
}
