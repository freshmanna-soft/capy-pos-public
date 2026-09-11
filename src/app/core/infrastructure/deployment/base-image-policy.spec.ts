/**
 * Docker base-image policy guard (Epic #288 item 1).
 *
 * `docs/spikes/2026-09-11-chainguard-base-image-decision.md` records the decision this
 * spec enforces: we keep the Alpine bases and add CVE scanning in CI, rather than
 * adopting Chainguard's free tier. The measured reason is that the free tier only
 * serves rolling `latest`/`latest-dev` (`cgr.dev/chainguard/node:22` resolves to
 * `not found`), and those tags carry Node 26 today against the 22 we deploy — so
 * taking them would hand an unannounced major bump to any rebuild.
 *
 * A decision written only in a markdown file is a decision the next `FROM` edit can
 * undo by accident. This spec is the part that cannot be undone silently: it reads
 * every container build file in the repo and asserts the *shape* of each base
 * reference, not the specific image, so a deliberate Node bump needs no test edit
 * while `FROM cgr.dev/chainguard/node:latest` fails immediately.
 *
 * Nothing else in the suite reads a Dockerfile — a floating base tag breaks nobody's
 * build on the day it is introduced, it breaks whoever rebuilds months later on a
 * silently different runtime. So this is the test that fails now instead.
 *
 * Two layers of tests, on purpose. The repo-scan tests below assert today's six
 * Dockerfiles comply; the synthetic-input tests assert the *parser* handles the shapes
 * this decision expects to arrive later — `--platform` flags, digest pins, registry
 * ports, intra-file stage references, `Dockerfile.dev`-style names. Without them the
 * parser's guards are unreachable by any file in the repo, so deleting one would leave
 * the scan green and the guard silently wrong on the first Dockerfile that needs it.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

/**
 * Tags that track a moving target: whatever the publisher built most recently. A
 * `FROM` on one of these produces a different runtime on every rebuild.
 */
const FLOATING_TAGS = ['latest', 'latest-dev', 'edge', 'main', 'stable'];

/**
 * Bases whose tag names a *variant* rather than a version, accepted here as
 * pre-existing state rather than as good practice.
 *
 * `nginx:alpine` does float nginx's own version — the root Dockerfile's serve stage
 * has always used it. It is listed so it is visible and countable instead of being
 * waved through by a rule that only looks for the literal string `latest`; anything
 * new arriving in this list is a deliberate act with a review attached, and item 3 of
 * the spike's re-scope proposes replacing this one entry outright.
 */
const VARIANT_TAG_ALLOWLIST = ['nginx:alpine'];

/**
 * Filenames Docker/Podman will build from. Matching on the basename rather than
 * asking git for `*Dockerfile` matters: a pathspec glob only catches paths that *end*
 * in `Dockerfile`, so `infra/foo/Dockerfile.dev`, `api.dockerfile` and `Containerfile`
 * would all be built by CI and skipped by this policy. `.dockerignore` and
 * `docker-compose.yml` are deliberately not build files and must not match.
 */
const CONTAINER_BUILD_FILENAME =
  /^(?:Dockerfile|Containerfile)(?:\..+)?$|\.(?:dockerfile|containerfile)$/i;

function isContainerBuildFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return CONTAINER_BUILD_FILENAME.test(basename);
}

interface BaseImageReference {
  /** Container build file path, relative to the repo root. */
  readonly file: string;
  /** The full image reference as written, e.g. `node:22-alpine`. */
  readonly reference: string;
}

/** Every container build file tracked by git, relative to the repo root. */
function trackedDockerfiles(): string[] {
  const listed = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' });
  return listed
    .split('\n')
    .filter((line) => line.length > 0)
    .filter(isContainerBuildFile);
}

/**
 * Base references from a Dockerfile's `FROM` lines.
 *
 * `FROM <stage>` where `<stage>` is an earlier `AS` name is not a base image — it is
 * an intra-file reference — so named stages are collected first and then excluded.
 * Flags such as `FROM --platform=linux/amd64 <image>` sit between `FROM` and the
 * reference and are dropped the same way.
 */
function parseBaseImageReferences(contents: string, file: string): BaseImageReference[] {
  const fromLines = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^FROM\s/i.test(line));

  const stageNames = fromLines
    .map((line) => /\sAS\s+(\S+)\s*$/i.exec(line)?.[1]?.toLowerCase())
    .filter((name): name is string => name !== undefined);

  return fromLines
    .map((line) => line.replace(/^FROM\s+/i, '').replace(/\s+AS\s+\S+\s*$/i, ''))
    .map((rest) => rest.split(/\s+/).filter((token) => !token.startsWith('--')))
    .map((tokens) => tokens[0])
    .filter((reference): reference is string => reference !== undefined)
    .filter((reference) => !stageNames.includes(reference.toLowerCase()))
    .map((reference) => ({ file, reference }));
}

function baseImageReferences(file: string): BaseImageReference[] {
  return parseBaseImageReferences(readFileSync(resolve(REPO_ROOT, file), 'utf-8'), file);
}

function allBaseImages(): BaseImageReference[] {
  return trackedDockerfiles().flatMap(baseImageReferences);
}

/** The tag portion of a reference, or undefined when it is digest-pinned or untagged. */
function tagOf(reference: string): string | undefined {
  if (reference.includes('@sha256:')) return undefined;
  // Split on the last `:` so a registry port (`host:5000/image`) is not mistaken for a tag.
  const lastColon = reference.lastIndexOf(':');
  if (lastColon === -1) return undefined;
  const candidate = reference.slice(lastColon + 1);
  return candidate.includes('/') ? undefined : candidate;
}

function isDigestPinned(reference: string): boolean {
  return /@sha256:[0-9a-f]{64}$/.test(reference);
}

const DIGEST = 'a'.repeat(64);

describe('Docker base-image policy (#288 item 1)', () => {
  it('finds a Dockerfile to check, so a broken scan cannot pass vacuously', () => {
    const dockerfiles = trackedDockerfiles();

    expect(dockerfiles).toContain('Dockerfile');
    expect(dockerfiles.length).toBeGreaterThanOrEqual(6);
  });

  it('reads a base image out of every Dockerfile', () => {
    const filesWithBases = new Set(allBaseImages().map(({ file }) => file));

    expect([...filesWithBases].sort()).toEqual(trackedDockerfiles().sort());
  });

  it('pins every base image by tag or digest — never a bare image name', () => {
    const bare = allBaseImages().filter(
      ({ reference }) => !isDigestPinned(reference) && tagOf(reference) === undefined
    );

    expect(bare).toEqual([]);
  });

  it('rejects floating tags, which change the runtime on any rebuild', () => {
    const floating = allBaseImages().filter(({ reference }) => {
      const tag = tagOf(reference);
      return tag !== undefined && FLOATING_TAGS.includes(tag);
    });

    expect(floating).toEqual([]);
  });

  it('requires a version in the tag, except for the recorded variant-tag allowlist', () => {
    const versionless = allBaseImages().filter(({ reference }) => {
      if (isDigestPinned(reference)) return false;
      if (VARIANT_TAG_ALLOWLIST.includes(reference)) return false;
      const tag = tagOf(reference);
      return tag !== undefined && !/\d/.test(tag);
    });

    expect(versionless).toEqual([]);
  });

  it('requires any cgr.dev base to be digest-pinned, because its free tier has no version tag', () => {
    const unpinnedChainguard = allBaseImages().filter(
      ({ reference }) => reference.startsWith('cgr.dev/') && !isDigestPinned(reference)
    );

    expect(unpinnedChainguard).toEqual([]);
  });
});

/**
 * Synthetic inputs for the discovery filter and the parser. Every case here is a shape
 * the repo does not contain today but CI would build (or this decision expects items
 * 2–7 to introduce), which is exactly why the scan above cannot cover them.
 */
describe('container build file discovery (#288 item 1)', () => {
  it('accepts every filename Docker will build from, not only paths ending in `Dockerfile`', () => {
    const paths = [
      'Dockerfile',
      'infra/pos-api/Dockerfile',
      'infra/pos-api/Dockerfile.dev',
      'infra/pos-api/api.dockerfile',
      'infra/pos-api/Containerfile',
      'infra/pos-api/Containerfile.build',
    ];

    expect(paths.filter(isContainerBuildFile)).toEqual(paths);
  });

  it('rejects docker files that are not build files', () => {
    const paths = [
      '.dockerignore',
      'infra/vision-proxy/.dockerignore',
      'docker-compose.yml',
      'infra/graphrag/docker-compose.yml',
      'docs/DockerfileNotes.md',
      'src/app/core/infrastructure/deployment/base-image-policy.spec.ts',
    ];

    expect(paths.filter(isContainerBuildFile)).toEqual([]);
  });
});

describe('base reference parsing (#288 item 1)', () => {
  it('takes the image, not the flag, from a `FROM --platform=… <image>` line', () => {
    const parsed = parseBaseImageReferences(
      'FROM --platform=linux/amd64 node:22-alpine AS build\n',
      'Dockerfile'
    );

    expect(parsed).toEqual([{ file: 'Dockerfile', reference: 'node:22-alpine' }]);
  });

  it('ignores `FROM <stage>` references to an earlier stage in the same file', () => {
    const parsed = parseBaseImageReferences(
      ['FROM node:22-alpine AS build', 'FROM BUILD AS test', 'FROM nginx:alpine'].join('\n'),
      'Dockerfile'
    );

    expect(parsed.map(({ reference }) => reference)).toEqual(['node:22-alpine', 'nginx:alpine']);
  });

  it('reads no tag from a digest-pinned reference, so a digest is never scanned as a tag', () => {
    expect(tagOf(`cgr.dev/chainguard/node@sha256:${DIGEST}`)).toBeUndefined();
    expect(tagOf(`node:22-alpine@sha256:${DIGEST}`)).toBeUndefined();
  });

  it('reads no tag from a registry port, and the real tag when one follows it', () => {
    expect(tagOf('us.icr.io:443/capy-pos/pos-api')).toBeUndefined();
    expect(tagOf('us.icr.io:443/capy-pos/pos-api:1.4.0')).toBe('1.4.0');
  });

  it('reads the tag from an ordinary reference and none from a bare image name', () => {
    expect(tagOf('node:22-alpine')).toBe('22-alpine');
    expect(tagOf('node')).toBeUndefined();
  });

  it('accepts only a full 64-character sha256 digest as a pin', () => {
    expect(isDigestPinned(`cgr.dev/chainguard/node@sha256:${DIGEST}`)).toBe(true);
    expect(isDigestPinned('cgr.dev/chainguard/node@sha256:abc123')).toBe(false);
    expect(isDigestPinned('cgr.dev/chainguard/node:latest')).toBe(false);
  });
});
