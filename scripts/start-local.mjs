import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const usage = '用法：npm run dev:local [-- --port 3010]';

function parsePort(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return null;
  }
  let value = '3010';
  if (args.length === 2 && args[0] === '--port') value = args[1];
  else if (args.length === 1 && args[0].startsWith('--port=')) value = args[0].slice(7);
  else if (args.length) throw new Error(usage);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('端口必须是 1–65535 之间的整数。' + usage);
  }
  return Number(value);
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port} 已被占用。若本地版已经启动，请打开 http://${host}:${port}；否则先停止占用该端口的程序。不会自动切换端口，以免看不到原有浏览器数据。`));
      } else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
  });
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  if (port === null) return;
  const vite = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) {
    throw new Error('尚未安装项目依赖。请在包含 package.json 的项目目录先运行 npm ci，再运行 npm run dev:local。');
  }
  await checkPort(port);
  console.log(`\nmodel_eval 本地版：http://${host}:${port}\n音频和分析随代码内置，评价保存在当前浏览器中。以后请使用相同浏览器和地址。按 Ctrl+C 停止。\n`);
  // Launch Node directly: no shell syntax or npm.cmd quoting is needed on Windows.
  const child = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'inherit',
    shell: false,
  });
  let stopping = false;
  const onInterrupt = () => { stopping = true; child.kill('SIGINT'); };
  const onTerminate = () => { stopping = true; child.kill('SIGTERM'); };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  child.once('error', error => {
    console.error(`本地服务启动失败：${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.exitCode = stopping ? 0 : code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
  });
}

main().catch(error => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});
