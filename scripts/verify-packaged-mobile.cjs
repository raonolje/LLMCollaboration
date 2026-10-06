const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const archive = process.argv[2] || 'release/fix-verification-20261002/win-unpacked/resources/app.asar';
const extract = (name) => asar.extractFile(archive, name.replace(/\//g, path.sep));
const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const filename = path.join(folder, entry.name);
  return entry.isDirectory() ? walk(filename) : [filename];
});
const assets = walk('mobile/web-dist').map((file) => {
  const local = fs.readFileSync(file), packed = extract(file);
  if (!packed.equals(local)) throw new Error(`Packaged asset differs: ${file}`);
  return { file, bytes: packed.length, sha256: crypto.createHash('sha256').update(packed).digest('hex') };
});
const compiled = extract('dist-electron/main/services/discussion-context.js');
if (!compiled.equals(fs.readFileSync('dist-electron/main/services/discussion-context.js'))) throw new Error('Packaged context code differs');
const evidence = { version: JSON.parse(extract('package.json')).version, archive, allMobileAssetsMatch: true, assets, contextIncluded: true };
fs.mkdirSync('work/fix-verification-20261002', { recursive: true });
fs.writeFileSync('work/fix-verification-20261002/package-evidence.json', JSON.stringify(evidence, null, 2));
console.log(`PASS: ${assets.length} packaged mobile files and context code match local build`);
