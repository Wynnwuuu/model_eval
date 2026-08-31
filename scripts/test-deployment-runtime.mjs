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
const workerDeployment = await readFile(new URL('../deploy/base/generation-worker-deployment.yml', import.meta.url), 'utf8');
const baseKustomization = await readFile(new URL('../deploy/base/kustomization.yml', import.meta.url), 'utf8');
const deployWorkflow = await readFile(new URL('../.github/workflows/eval-studio-deploy.yml', import.meta.url), 'utf8');
const manifestSplitter = await readFile(new URL('./split-deployment-manifest.mjs', import.meta.url), 'utf8');
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
  /- name: GENERATION_EXECUTION_ENABLED\r?\n\s+value: "true"/,
  'dev API must allow batch admission when an independent worker fleet is healthy',
);
assert.match(
  devConfig,
  /- name: GENERATION_WORKER_ENABLED\r?\n\s+value: "false"/,
  'dev API pods must not run generation worker loops',
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

assert.match(baseKustomization, /generation-worker-deployment\.yml/,
  'the independent worker deployment must be part of the base release');
assert.match(workerDeployment, /name: eval-studio-generation-worker/);
assert.match(workerDeployment, /replicas: 2/,
  'two worker replicas are required so one process can drain or fail without pausing generation');
assert.match(workerDeployment, /app: eval-studio-generation-worker/g,
  'worker pods need a distinct selector so the public API Service never routes to them');
assert.match(workerDeployment, /terminationGracePeriodSeconds: 600/);
assert.match(workerDeployment, /- name: GENERATION_EXECUTION_ENABLED\r?\n\s+value: "true"/);
assert.match(workerDeployment, /- name: GENERATION_WORKER_ENABLED\r?\n\s+value: "true"/);
assert.match(workerDeployment, /- name: NODE_OPTIONS\r?\n\s+value: "--max-old-space-size=768"/);
assert.match(workerDeployment, /memory: "1536Mi"/,
  'worker containers need native-memory headroom around the 768 MiB V8 heap');
assert.match(workerDeployment, /path: \/health\/live/);
assert.match(workerDeployment, /path: \/health\/ready/);
assert.doesNotMatch(workerDeployment, /FEISHU_APP_SECRET|JWT_SECRET|OWNER_ACCESS_KEY/,
  'worker pods must not receive unrelated web authentication credentials');
assert.match(deployWorkflow, /ACK_WORKER_DEPLOYMENT_NAME: eval-studio-generation-worker/);
assert.match(deployWorkflow, /generation-queue-audit/,
  'deployment must audit stranded pending or submitting work before enabling the worker fleet');
assert.match(deployWorkflow, /rollout status deployment\/\$ACK_WORKER_DEPLOYMENT_NAME/);
assert.match(deployWorkflow, /app=eval-studio-generation-worker/,
  'deployment stability checks must observe the independent worker pods');
assert.match(deployWorkflow, /split-deployment-manifest\.mjs/,
  'migration, API, audit, and worker resources must be applied in separate release phases');
assert.match(manifestSplitter, /groups = \{ migration: \[\], audit: \[\], worker: \[\], api: \[\] \}/);

console.log('Deployment runtime regression tests passed.');
