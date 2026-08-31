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
assert.match(
  devConfig,
  /spec:\r?\n\s+replicas: 2/,
  'dev must keep two API replicas while generation execution is isolated from the web service',
);
assert.match(
  devConfig,
  /- name: GENERATION_WORKER_ENABLED\r?\n\s+value: "false"/,
  'dev generation execution must remain paused during native-exit isolation',
);
assert.match(
  devConfig,
  /- name: NODE_OPTIONS\r?\n\s+value: "--max-old-space-size=1024"/,
  'dev must retain a bounded one-GiB V8 heap while the API serves large evaluation datasets',
);
assert.match(
  devConfig,
  /limits:\r?\n\s+cpu: "1"\r?\n\s+memory: "2Gi"/,
  'the dev container limit must leave native-memory headroom around the one-GiB V8 heap',
);

console.log('Deployment runtime regression tests passed.');
