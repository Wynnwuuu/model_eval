import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const baseImages = Array.from(dockerfile.matchAll(/^FROM\s+([^\s]+)(?:\s+AS\s+\S+)?$/gmi), match => match[1]);

assert.deepEqual(
  baseImages,
  ['node:22.23.2-bookworm-slim', 'node:22.23.2-bookworm-slim'],
  'build and runtime stages must use the pinned Debian/glibc Node image that is validated in dev',
);
assert.doesNotMatch(
  dockerfile,
  /node:[^\s]*alpine/i,
  'Alpine/musl must not be reintroduced after the observed native exit-139 crash loop',
);

const devConfig = await readFile(new URL('../deploy/overlays/dev/patch-config.yml', import.meta.url), 'utf8');
assert.match(
  devConfig,
  /- name: GENERATION_IMAGE_CONCURRENCY\r?\n\s+value: "1"/,
  'dev image concurrency must remain conservative until synchronous generation is stable under the glibc runtime',
);

console.log('Deployment runtime regression tests passed.');
