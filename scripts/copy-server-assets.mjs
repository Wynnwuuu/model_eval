import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'server', 'db', 'migrations');
const targetDir = path.join(root, 'dist-server', 'server', 'db');
const target = path.join(targetDir, 'migrations');

await mkdir(targetDir, { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
