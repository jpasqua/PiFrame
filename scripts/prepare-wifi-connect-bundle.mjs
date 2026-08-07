import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = 'v4.11.84';
const assets = [
  {
    name: 'wifi-connect-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '413d70e6d1c1366cbe2b32555e8476f3e92878178ed1b9c82205985f055f1936',
  },
  {
    name: 'wifi-connect-ui.tar.gz',
    sha256: 'e57a3cec559729516decf892beb1e7f191b23e71b2e13bcd43d36b980034ffbe',
  },
];

const usbRoot = process.argv[2];
if (!usbRoot) {
  console.error('Usage: node scripts/prepare-wifi-connect-bundle.mjs /path/to/usb-root');
  process.exit(64);
}

const destination = resolve(usbRoot, 'piframe-provision', 'wifi-connect');
await mkdir(destination, { recursive: true });

for (const asset of assets) {
  const url = `https://github.com/balena-os/wifi-connect/releases/download/${version}/${asset.name}`;
  process.stdout.write(`Downloading ${asset.name}... `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);

  const content = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(`${asset.name}: expected ${asset.sha256}, received ${actual}`);
  }

  const output = resolve(destination, asset.name);
  await writeFile(`${output}.partial`, content, { mode: 0o644 });
  await rename(`${output}.partial`, output);
  console.log('verified');
}

await writeFile(
  resolve(destination, 'manifest.json'),
  `${JSON.stringify({ source: 'balena-os/wifi-connect', version, assets }, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(`WiFi Connect bundle ready at ${destination}`);
