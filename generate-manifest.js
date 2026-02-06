/**
 * generate-manifest.js
 * Run before deploying: node generate-manifest.js
 * Scans data/ for .json files and writes data/manifest.json
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json') && f !== 'manifest.json')
    .sort();

fs.writeFileSync(
    path.join(dataDir, 'manifest.json'),
    JSON.stringify(files, null, 2) + '\n'
);

console.log(`✅ manifest.json updated with ${files.length} brand(s): ${files.join(', ')}`);
