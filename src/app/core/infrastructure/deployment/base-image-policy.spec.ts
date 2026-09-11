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
 * ## Why the rules are predicates and not inline `filter` bodies
 *
 * The repo complies with this policy today, which means a scan of the repo cannot prove
 * the policy: every rule expressed only as `expect(scan.filter(…)).toEqual([])` is a rule
 * you can delete with the suite still green. So the four rules live in `POLICY_RULES` as
 * named predicates over a parsed reference, `policyViolations()` applies them, and each
 * rule has synthetic cases that *do* violate it. The repo scan then asserts one thing —
 * today's Dockerfiles produce no violations — and the rules keep their own tests.
 *
 * Same reasoning for the parser and the discovery filter: no Dockerfile here uses
 * `FROM --platform=…`, a digest pin, a `host:port/` registry or `FROM <stage>`, and none
 * is named `Dockerfile.dev`, so those branches are unreachable from the repo and get
 * synthetic inputs instead. Mutation-checked (22 mutants, all killed): emptying any of
 * the three constants, dropping any of the four rules, or removing any parser, discovery
 * or normalization guard turns a test red.
 *
 * Tags are compared case-insensitively throughout. Docker tags are case-sensitive, so
 * `node:LATEST` is not literally `node:latest` — but it is not a version pin either, and
 * a policy that reads `FROM`/`AS`/filenames case-insensitively while reading tags
 * exact-case just leaves a hole in the shape of `node:LATEST-22`.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

/**
 * Tags that track a moving target: whatever the publisher built most recently. A `FROM`
 * on one of these produces a different runtime on every rebuild.
 *
 * `latest-dev` is not listed because the whole `latest-*` family floats — `latest-dev`,
 * `latest-alpine` and `latest-22` are all rebuilt in place — and `isFloatingTag` covers
 * the family by prefix.
 */
const FLOATING_TAGS = ['latest', 'edge', 'main', 'stable'];

/**
 * Tags that name a specific upstream release without containing a digit. Debian and
 * Ubuntu ship codenames rather than numbers, so `debian:bookworm` is as precise a pin as
 * `node:22` is and must not be reported as unversioned. New entries are a deliberate act:
 * a codename is only a pin if upstream never moves it.
 */
const RELEASE_CODENAME_TAGS = ['bookworm', 'bullseye', 'trixie', 'jammy', 'noble'];

/**
 * Bases whose tag names a *variant* rather than a version, accepted here as pre-existing
 * state rather than as good practice.
 *
 * `nginx:alpine` does float nginx's own version — the root Dockerfile's serve stage has
 * always used it. It is listed so it is visible and countable instead of being waved
 * through by a rule that only looks for the literal string `latest`; anything new arriving
 * in this list is a deliberate act with a review attached, and item 3 of the spike's
 * re-scope proposes replacing this one entry outright.
 *
 * Keyed on repository *and* tag, both normalized, so the entry cannot be side-stepped by
 * spelling the same image `docker.io/library/nginx:alpine`.
 */
const VARIANT_TAG_ALLOWLIST = [{ repository: 'nginx', tag: 'alpine' }];

/** Container build files that must be found, or the scan is not looking at the repo. */
const DEPLOYED_BUILD_FILES = [
  'Dockerfile',
  'infra/appid-token-relay/Dockerfile',
  'infra/clerk-agent-relay/Dockerfile',
  'infra/pos-api/Dockerfile',
  'infra/vision-proxy/Dockerfile',
];

/**
 * Filenames Docker/Podman will build from. Matching on the basename rather than asking
 * git for `*Dockerfile` matters: a pathspec glob only catches paths that *end* in
 * `Dockerfile`, so `infra/foo/Dockerfile.dev`, `api.dockerfile` and `Containerfile` would
 * all be built by CI and skipped by this policy.
 */
const CONTAINER_BUILD_FILENAME =
  /^(?:Dockerfile|Containerfile)(?:\..+)?$|\.(?:dockerfile|containerfile)$/i;

/**
 * Suffixes that make a `Dockerfile.*` name prose or config rather than a build file.
 * `Dockerfile.md` is one character from `Dockerfile.dev` and nothing builds it; scanning
 * it for `FROM` lines would report violations against a document.
 */
const NON_BUILD_SUFFIX = /\.(?:md|markdown|txt|ya?ml|json|ts|js|mjs|sh|log|bak|snap)$/i;

function isContainerBuildFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  if (NON_BUILD_SUFFIX.test(basename)) return false;
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
 * `FROM <stage>` where `<stage>` is an earlier `AS` name is not a base image — it is an
 * intra-file reference — so named stages are collected first and then excluded. Flags such
 * as `FROM --platform=linux/amd64 <image>` sit between `FROM` and the reference and are
 * dropped the same way.
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
    .flatMap((tokens) => (tokens.length === 0 ? [] : [tokens[0]]))
    .filter((reference) => !stageNames.includes(reference.toLowerCase()))
    .map((reference) => ({ file, reference }));
}

function baseImageReferences(file: string): BaseImageReference[] {
  return parseBaseImageReferences(readFileSync(resolve(REPO_ROOT, file), 'utf-8'), file);
}

function allBaseImages(): BaseImageReference[] {
  return trackedDockerfiles().flatMap(baseImageReferences);
}

interface ParsedReference {
  /**
   * Repository with Docker Hub's implicit prefix normalized away, so `nginx`,
   * `library/nginx` and `docker.io/library/nginx` are one repository.
   */
  readonly repository: string;
  /** Tag exactly as written, or undefined when the reference carries none. */
  readonly tag: string | undefined;
  /** Digest exactly as written (`sha256:…`), or undefined. */
  readonly digest: string | undefined;
}

const IMPLICIT_DOCKER_HUB_PREFIX = /^(?:docker\.io\/)?(?:library\/)?/;

function parseReference(reference: string): ParsedReference {
  const at = reference.indexOf('@');
  const digest = at === -1 ? undefined : reference.slice(at + 1);
  const name = at === -1 ? reference : reference.slice(0, at);

  // A `:` introduces a tag only after the last `/`; before it, it is a registry port
  // (`us.icr.io:443/capy-pos/pos-api`).
  const lastColon = name.lastIndexOf(':');
  const tagged = lastColon > name.lastIndexOf('/');

  return {
    repository: (tagged ? name.slice(0, lastColon) : name).replace(IMPLICIT_DOCKER_HUB_PREFIX, ''),
    tag: tagged ? name.slice(lastColon + 1) : undefined,
    digest,
  };
}

/** True only for a complete, immutable pin — a truncated digest does not pull. */
function isDigestPinned({ digest }: ParsedReference): boolean {
  return digest !== undefined && /^sha256:[0-9a-f]{64}$/.test(digest);
}

function isFloatingTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return FLOATING_TAGS.includes(normalized) || normalized.startsWith('latest-');
}

function isUnversionedTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  if (RELEASE_CODENAME_TAGS.includes(normalized)) return false;
  return !/\d/.test(normalized);
}

function isAllowlistedVariant({ repository, tag }: ParsedReference): boolean {
  return VARIANT_TAG_ALLOWLIST.some(
    (entry) => entry.repository === repository && entry.tag === tag?.toLowerCase()
  );
}

type PolicyRule = 'unpinned' | 'floating-tag' | 'unversioned-tag' | 'unpinned-cgr-dev';

interface PolicyViolation extends BaseImageReference {
  readonly rule: PolicyRule;
}

/** The decision, as rules. Each one has its own synthetic cases below. */
const POLICY_RULES: readonly {
  readonly rule: PolicyRule;
  readonly violates: (parsed: ParsedReference) => boolean;
}[] = [
  {
    rule: 'unpinned',
    violates: (parsed) => parsed.tag === undefined && !isDigestPinned(parsed),
  },
  {
    rule: 'floating-tag',
    violates: (parsed) => parsed.tag !== undefined && isFloatingTag(parsed.tag),
  },
  {
    rule: 'unversioned-tag',
    violates: (parsed) =>
      parsed.tag !== undefined && !isAllowlistedVariant(parsed) && isUnversionedTag(parsed.tag),
  },
  {
    rule: 'unpinned-cgr-dev',
    violates: (parsed) => parsed.repository.startsWith('cgr.dev/') && !isDigestPinned(parsed),
  },
];

function policyViolations(references: readonly BaseImageReference[]): PolicyViolation[] {
  return references.flatMap(({ file, reference }) => {
    const parsed = parseReference(reference);
    return POLICY_RULES.filter(({ violates }) => violates(parsed)).map(({ rule }) => ({
      file,
      reference,
      rule,
    }));
  });
}

/** Rules a single reference breaks, for the synthetic cases below. */
function rulesFor(reference: string): PolicyRule[] {
  return policyViolations([{ file: 'Dockerfile', reference }]).map(({ rule }) => rule);
}

const DIGEST = 'a'.repeat(64);

describe('Docker base-image policy — the repo as it stands (#288 item 1)', () => {
  it('finds every deployed service build file, so a broken scan cannot pass vacuously', () => {
    expect(trackedDockerfiles()).toEqual(expect.arrayContaining(DEPLOYED_BUILD_FILES));
  });

  it('reads a base image out of every container build file', () => {
    const filesWithBases = new Set(allBaseImages().map(({ file }) => file));

    expect([...filesWithBases].sort()).toEqual(trackedDockerfiles().sort());
  });

  it('breaks no policy rule', () => {
    expect(policyViolations(allBaseImages())).toEqual([]);
  });
});

/**
 * Synthetic references. The repo has no violations — that is the point of the decision —
 * so these are what actually prove each rule, and what fails if one is deleted or
 * weakened.
 */
describe('Docker base-image policy — the rules (#288 item 1)', () => {
  it('accepts the bases the repo deploys today', () => {
    expect(rulesFor('node:22-alpine')).toEqual([]);
    expect(rulesFor('nginx:alpine')).toEqual([]);
    expect(rulesFor('pgvector/pgvector:pg16')).toEqual([]);
  });

  it('rejects a bare image name, which resolves to whatever `latest` is today', () => {
    expect(rulesFor('node')).toContain('unpinned');
    expect(rulesFor('cgr.dev/chainguard/node')).toContain('unpinned');
  });

  it('rejects a truncated digest, which pins nothing and does not pull', () => {
    expect(rulesFor('node@sha256:abc123')).toContain('unpinned');
    expect(rulesFor(`node@sha256:${DIGEST}`)).toEqual([]);
  });

  // Spelled out rather than looped over `FLOATING_TAGS`: a `for (const tag of FLOATING_TAGS)`
  // passes vacuously the moment someone empties the constant, which is the mutation this
  // test exists to catch.
  it('rejects every floating tag by name', () => {
    expect(rulesFor('node:latest')).toContain('floating-tag');
    expect(rulesFor('node:edge')).toContain('floating-tag');
    expect(rulesFor('node:main')).toContain('floating-tag');
    expect(rulesFor('node:stable')).toContain('floating-tag');
  });

  it('rejects the whole `latest-*` family, not just the bare word', () => {
    expect(rulesFor('node:latest-dev')).toContain('floating-tag');
    expect(rulesFor('node:latest-alpine')).toContain('floating-tag');
    // Carries a digit, so the unversioned rule does not catch it — only this one does.
    expect(rulesFor('node:latest-22')).toEqual(['floating-tag']);
  });

  it('reads tags case-insensitively, so an uppercase spelling is not a loophole', () => {
    expect(rulesFor('node:LATEST')).toContain('floating-tag');
    expect(rulesFor('node:LATEST-22')).toEqual(['floating-tag']);
    expect(rulesFor('node:Stable')).toContain('floating-tag');
    expect(rulesFor('redis:ALPINE')).toContain('unversioned-tag');
  });

  it('rejects a tag with no version, and does not confuse `stable-alpine` with `stable`', () => {
    expect(rulesFor('redis:alpine')).toContain('unversioned-tag');
    expect(rulesFor('nginx:stable-alpine')).toContain('unversioned-tag');
    expect(rulesFor('nginx:stable-alpine')).not.toContain('floating-tag');
  });

  it('accepts a release codename as a version, because upstream does not move it', () => {
    expect(rulesFor('debian:bookworm')).toEqual([]);
    expect(rulesFor('debian:bullseye')).toEqual([]);
    expect(rulesFor('debian:trixie')).toEqual([]);
    expect(rulesFor('ubuntu:jammy')).toEqual([]);
    expect(rulesFor('ubuntu:noble')).toEqual([]);
    // Looked up case-normalized, like every other tag comparison here.
    expect(rulesFor('debian:BOOKWORM')).toEqual([]);
    // A codename is an allowance for named releases, not for any digitless tag.
    expect(rulesFor('debian:testing')).toContain('unversioned-tag');
  });

  it('accepts an allowlisted variant tag however the image is spelled', () => {
    expect(rulesFor('nginx:alpine')).toEqual([]);
    expect(rulesFor('library/nginx:alpine')).toEqual([]);
    expect(rulesFor('docker.io/library/nginx:alpine')).toEqual([]);
    expect(rulesFor('nginx:ALPINE')).toEqual([]);
    // The allowlist is one image, not the `alpine` tag in general.
    expect(rulesFor('redis:alpine')).toContain('unversioned-tag');
  });

  it('requires a cgr.dev base to be digest-pinned, since its free tier has no version tag', () => {
    // The reference the spike doc says this guard exists to catch.
    expect(rulesFor('cgr.dev/chainguard/node:latest')).toContain('unpinned-cgr-dev');
    expect(rulesFor('cgr.dev/chainguard/node:latest')).toContain('floating-tag');
    // A version-shaped cgr.dev tag is still rejected: on the free tier it is `not found`.
    expect(rulesFor('cgr.dev/chainguard/node:22')).toEqual(['unpinned-cgr-dev']);
    expect(rulesFor(`cgr.dev/chainguard/node@sha256:${DIGEST}`)).toEqual([]);
  });

  it('reports the file and reference that broke each rule, not just a count', () => {
    expect(
      policyViolations([{ file: 'infra/pos-api/Dockerfile', reference: 'node:latest' }])
    ).toEqual([
      { file: 'infra/pos-api/Dockerfile', reference: 'node:latest', rule: 'floating-tag' },
      { file: 'infra/pos-api/Dockerfile', reference: 'node:latest', rule: 'unversioned-tag' },
    ]);
  });
});

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

  it('rejects prose and config that happens to be named `Dockerfile.<suffix>`', () => {
    const paths = [
      'docs/Dockerfile.md',
      'docs/Dockerfile.txt',
      'infra/pos-api/Dockerfile.yml',
      'infra/pos-api/Dockerfile.json',
      'scripts/Dockerfile.mjs',
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

  it('reads nothing from a `FROM` line that carries only flags', () => {
    expect(parseBaseImageReferences('FROM --platform=linux/amd64\n', 'Dockerfile')).toEqual([]);
  });

  it('ignores `FROM <stage>` references to an earlier stage in the same file', () => {
    const parsed = parseBaseImageReferences(
      ['FROM node:22-alpine AS build', 'FROM BUILD AS test', 'FROM nginx:alpine'].join('\n'),
      'Dockerfile'
    );

    expect(parsed.map(({ reference }) => reference)).toEqual(['node:22-alpine', 'nginx:alpine']);
  });

  it('splits a digest off the reference instead of reading it as a tag', () => {
    expect(parseReference(`cgr.dev/chainguard/node@sha256:${DIGEST}`)).toEqual({
      repository: 'cgr.dev/chainguard/node',
      tag: undefined,
      digest: `sha256:${DIGEST}`,
    });
    expect(parseReference(`node:22-alpine@sha256:${DIGEST}`).tag).toBe('22-alpine');
  });

  it('reads no tag from a registry port, and the real tag when one follows it', () => {
    expect(parseReference('us.icr.io:443/capy-pos/pos-api').tag).toBeUndefined();
    expect(parseReference('us.icr.io:443/capy-pos/pos-api').repository).toBe(
      'us.icr.io:443/capy-pos/pos-api'
    );
    expect(parseReference('us.icr.io:443/capy-pos/pos-api:1.4.0').tag).toBe('1.4.0');
  });

  it('reads the tag from an ordinary reference and none from a bare image name', () => {
    expect(parseReference('node:22-alpine').tag).toBe('22-alpine');
    expect(parseReference('node').tag).toBeUndefined();
  });

  it("normalizes Docker Hub's implicit prefix, and leaves other registries alone", () => {
    expect(parseReference('docker.io/library/nginx:alpine').repository).toBe('nginx');
    expect(parseReference('library/nginx:alpine').repository).toBe('nginx');
    expect(parseReference('pgvector/pgvector:pg16').repository).toBe('pgvector/pgvector');
    expect(parseReference('ghcr.io/library/example:1.0').repository).toBe(
      'ghcr.io/library/example'
    );
  });

  it('accepts only a full 64-character sha256 digest as a pin', () => {
    expect(isDigestPinned(parseReference(`cgr.dev/chainguard/node@sha256:${DIGEST}`))).toBe(true);
    expect(isDigestPinned(parseReference('cgr.dev/chainguard/node@sha256:abc123'))).toBe(false);
    expect(isDigestPinned(parseReference('cgr.dev/chainguard/node:latest'))).toBe(false);
  });
});
