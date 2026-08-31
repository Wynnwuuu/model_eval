import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPrefix, buildVersion] = process.argv.slice(2);
if (!inputPath || !outputPrefix || !buildVersion) {
  throw new Error('Usage: split-deployment-manifest <input> <output-prefix> <build-version>');
}

const rendered = (await readFile(inputPath, 'utf8'))
  .replaceAll('value: __BUILD_VERSION__', `value: ${JSON.stringify(buildVersion)}`);
await writeFile(inputPath, rendered);

const documents = rendered.split(/^---\s*$/m).map(document => document.trim()).filter(Boolean);
const resourceIdentity = (document) => {
  const kind = document.match(/^kind:\s*([^\s#]+)/m)?.[1];
  const metadata = document.match(/^metadata:\s*\n([\s\S]*?)(?=^[^ \t\r\n])/m)?.[1] || '';
  const name = metadata.match(/^\s{2}name:\s*([^\s#]+)/m)?.[1];
  return { kind, name };
};

const groups = { migration: [], audit: [], worker: [], api: [] };
for (const document of documents) {
  const { kind, name } = resourceIdentity(document);
  if (kind === 'Job' && name === 'eval-studio-migrate') groups.migration.push(document);
  else if (kind === 'Job' && name === 'eval-studio-generation-queue-audit') groups.audit.push(document);
  else if (kind === 'Deployment' && name === 'eval-studio-generation-worker') groups.worker.push(document);
  else groups.api.push(document);
}

for (const [group, entries] of Object.entries(groups)) {
  if (!entries.length) throw new Error(`Rendered manifest group ${group} is empty`);
  await writeFile(`${outputPrefix}-${group}.yml`, `${entries.join('\n---\n')}\n`);
}
