#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', '@js-temporal', 'polyfill', 'dist', 'index.umd.js');
const target = path.join(root, 'core', 'vendor', 'temporal-polyfill.js');

if (!fs.existsSync(source)) {
  throw new Error('Temporal n’est pas installé. Exécutez npm install avant le build.');
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`✓ Polyfill Temporal copié : ${target}`);
