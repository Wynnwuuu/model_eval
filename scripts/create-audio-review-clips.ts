import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { MediaProbeResult } from './lib/mediaProbe.ts';

const execFileAsync = promisify(execFile);
const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};
const probeFile = resolve(option('probe-file'));
const outputDir = resolve(option('output-dir'));
if (!option('probe-file') || !option('output-dir')) {
  throw new Error('Use --probe-file=<media-probe.json> --output-dir=<audio-review-dir>.');
}

const probes = JSON.parse(readFileSync(probeFile, 'utf8')) as MediaProbeResult[];
mkdirSync(outputDir, { recursive: true });
const eligible = probes.filter(probe =>
  probe.expectedKinds.includes('audio')
  && probe.decode.streams.some(stream => stream.kind === 'audio')
  && /^https?:\/\//i.test(probe.url));

let next = 0;
const failures: Array<{ url: string; message: string }> = [];
await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, async () => {
  while (next < eligible.length) {
    const index = next;
    next += 1;
    const probe = eligible[index];
    const stem = createHash('sha256').update(probe.url).digest('hex').slice(0, 20);
    const output = resolve(outputDir, `${stem}.mp3`);
    try {
      await execFileAsync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', probe.url,
        '-t', '8', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', output,
      ], { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      probe.audioPreviewPath = output;
    } catch (error) {
      failures.push({ url: probe.url, message: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
}));

writeFileSync(probeFile, `${JSON.stringify(probes, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ requested: eligible.length, created: eligible.length - failures.length, failures, outputDir }, null, 2));
