const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cache = path.join(root, '.tools/electron-cache');
const temporary = path.join(root, '.tools/desktop-temp');
const version = require('./package.json').devDependencies.electron;
const name = `electron-v${version}-win32-x64.zip`;
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  throw new Error('Desktop packaging requires Node.js >=22.12. Use a supported Node runtime.');
}
fs.mkdirSync(temporary, { recursive: true });
const archive = path.join(cache, name);
if (!fs.existsSync(archive)) throw new Error(`Download https://github.com/electron/electron/releases/download/v${version}/${name} to ${archive} first.`);
const expected = require('electron/checksums.json')[name];
const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (actual !== expected) throw new Error('Electron archive checksum mismatch.');
const profile = path.join(__dirname, 'dist/EnterpriseWorkspace-win32-x64/profile');
const profileBackup = path.join(root, '.tools', `desktop-profile-${Date.now()}`);
const hasProfile = fs.existsSync(profile);
if (hasProfile) {
  fs.cpSync(profile, profileBackup, { recursive: true, errorOnExist: true, force: false });
  console.log(`Desktop profile backup: ${profileBackup}`);
}
const result = spawnSync(process.execPath, [path.join(__dirname, 'node_modules/@electron/packager/bin/electron-packager.mjs'),
  '.', 'EnterpriseWorkspace', '--platform=win32', '--arch=x64', '--out=dist', '--overwrite',
  '--icon=application.ico', '--ignore=^/profile', '--ignore=^/dist', '--ignore=^/.npm-cache',
  `--electron-zip-dir=${cache}`, `--tmpdir=${temporary}`], {
  cwd: __dirname, stdio:'inherit', env:{...process.env, TEMP:temporary, TMP:temporary, ELECTRON_CACHE:cache}
});
if (result.error) throw result.error;
if (result.status === 0 && hasProfile) {
  fs.cpSync(profileBackup, profile, { recursive: true });
  console.log('Desktop profile restored; backup retained in .tools.');
}
process.exit(result.status ?? 1);
