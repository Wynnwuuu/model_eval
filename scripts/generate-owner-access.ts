import { generateOwnerAccessCredentials } from '../server/auth/ownerAccessCrypto.ts';

const readArgument = (name: string) => {
  const directIndex = process.argv.indexOf(name);
  if (directIndex >= 0) return process.argv[directIndex + 1] || '';
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || '';
};

const baseUrl = readArgument('--base-url');
if (!baseUrl) {
  console.error('Usage: npm run owner-access:generate -- --base-url https://eval.example.com');
  process.exitCode = 1;
} else {
  try {
    const credentials = generateOwnerAccessCredentials(baseUrl);
    console.log('Save the complete magic link in a trusted password manager. Do not commit or chat it.');
    console.log(`OWNER_ACCESS_KEY_SHA256=${credentials.keySha256}`);
    console.log(`fingerprint=${credentials.fingerprint}`);
    console.log(`permanent_key=${credentials.accessKey}`);
    console.log(`magic_link=${credentials.magicLink}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
