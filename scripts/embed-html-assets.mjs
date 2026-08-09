import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));

if (!args.input || !args.output) {
  throw new Error('Use --input=<html> --output=<self-contained-html>.');
}

const inputPath = resolve(args.input);
const outputPath = resolve(args.output);
const sourceDir = dirname(inputPath);
const mimeByExtension = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

let embeddedCount = 0;
let embeddedBytes = 0;
const sourceHtml = readFileSync(inputPath, 'utf8')
  .replace(/\sloading=(['"])lazy\1/gi, '')
  .replace('</head>', '<link rel="icon" href="data:,"></head>');
const bundledHtml = sourceHtml.replace(/\bsrc=(['"])([^'"]+)\1/g, (attribute, quote, source) => {
  if (/^(?:data:|https?:|blob:)/i.test(source)) return attribute;
  const assetPath = resolve(sourceDir, source);
  const relativeAssetPath = relative(sourceDir, assetPath);
  if (!relativeAssetPath || relativeAssetPath.startsWith('..') || /^[A-Za-z]:/.test(relativeAssetPath)) {
    throw new Error(`Refusing to embed an asset outside the HTML directory: ${source}`);
  }
  const mime = mimeByExtension[extname(assetPath).toLowerCase()];
  if (!mime) throw new Error(`Unsupported embedded asset type: ${source}`);
  const asset = readFileSync(assetPath);
  embeddedCount += 1;
  embeddedBytes += asset.length;
  return `src=${quote}data:${mime};base64,${asset.toString('base64')}${quote}`;
});

const remainingLocalSources = [...bundledHtml.matchAll(/\bsrc=(['"])([^'"]+)\1/g)]
  .map(match => match[2])
  .filter(source => !/^(?:data:|https?:|blob:)/i.test(source));
if (remainingLocalSources.length) {
  throw new Error(`The bundled HTML still contains ${remainingLocalSources.length} local source(s).`);
}

writeFileSync(outputPath, bundledHtml, 'utf8');
const output = readFileSync(outputPath);
console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  embeddedCount,
  embeddedBytes,
  outputBytes: output.length,
  sha256: createHash('sha256').update(output).digest('hex'),
  remainingLocalSources: remainingLocalSources.length,
}, null, 2));
