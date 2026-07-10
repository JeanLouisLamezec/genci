#!/usr/bin/env node
/* ============================================================================
 * check-taskflow-build.js — Vérifie que les widgets contiennent le bon code
 * ----------------------------------------------------------------------------
 * Ce script :
 * 1. Concatène les fichiers sources (taskflow-core.js + schema + bootstrap + migrations)
 * 2. Extrait le code injecté de chaque widget HTML
 * 3. Compare les hash SHA-256
 * 4. Échoue si un widget a une version obsolète
 * 
 * Usage : npm run check:taskflow-build
 * ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const SCHEMA_DIR = path.join(CORE_DIR, 'schema');

// Fichiers sources dans l'ordre d'injection
const SOURCE_FILES = [
    path.join(CORE_DIR, 'taskflow-core.js'),
    path.join(SCHEMA_DIR, 'taskflow-schema.js'),
    path.join(SCHEMA_DIR, 'taskflow-bootstrap.js'),
    path.join(SCHEMA_DIR, 'taskflow-migrations.js')
];

// Widgets à vérifier
const WIDGETS = [
    'kanban.html',
    'gantt.html',
    'plan.html',
    'calendar.html',
    'dashboard.html'
];

// Marqueurs
const START_MARKER = '// <taskflow-core> -- GENERE par scripts/build-taskflow.js, NE PAS EDITER ICI';
const END_MARKER = '// </taskflow-core>';

// Calcule le hash SHA-256 d'un string
function sha256(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Lit et concatène les sources
function readSources() {
    const parts = [];
    for (const file of SOURCE_FILES) {
        if (!fs.existsSync(file)) {
            throw new Error(`Fichier source manquant: ${file}`);
        }
        parts.push(fs.readFileSync(file, 'utf8'));
    }
    return parts.join('\n\n').trim(); // trim() pour correspondre à l'extraction
}

// Extrait le code injecté d'un widget
function extractInjectedCode(widgetPath) {
    const content = fs.readFileSync(widgetPath, 'utf8');
    
    const startIdx = content.indexOf(START_MARKER);
    const endIdx = content.indexOf(END_MARKER);
    
    if (startIdx === -1 || endIdx === -1) {
        throw new Error(`Marqueurs non trouvés dans ${path.basename(widgetPath)}`);
    }
    
    // Extraire le code entre les marqueurs (sans les marqueurs eux-mêmes)
    const codeStart = startIdx + START_MARKER.length + 1; // +1 pour le newline
    const codeEnd = endIdx;
    
    return content.substring(codeStart, codeEnd).trim();
}

// Main
function main() {
    console.log('🔍 Vérification du build TaskFlow...\n');
    
    // Lire les sources
    console.log('📄 Lecture des sources...');
    const sourceCode = readSources();
    const sourceHash = sha256(sourceCode);
    console.log(`   Hash source: ${sourceHash.substring(0, 16)}...`);
    console.log(`   Taille: ${sourceCode.length} octets\n`);
    
    // Vérifier chaque widget
    let allMatch = true;
    const results = [];
    
    for (const widget of WIDGETS) {
        const widgetPath = path.join(ROOT_DIR, widget);
        
        if (!fs.existsSync(widgetPath)) {
            console.warn(`⚠️  Widget non trouvé: ${widget}`);
            continue;
        }
        
        try {
            const injectedCode = extractInjectedCode(widgetPath);
            const injectedHash = sha256(injectedCode);
            
            const match = injectedHash === sourceHash;
            results.push({ widget, match, sourceHash, injectedHash });
            
            if (match) {
                console.log(`✅ ${widget} - OK`);
            } else {
                console.log(`❌ ${widget} - DIVERGENCE`);
                console.log(`   Source:   ${sourceHash.substring(0, 16)}...`);
                console.log(`   Widget:   ${injectedHash.substring(0, 16)}...`);
                console.log(`   Taille:   ${injectedCode.length} octets\n`);
                allMatch = false;
            }
        } catch (e) {
            console.error(`❌ ${widget} - ERREUR: ${e.message}`);
            results.push({ widget, error: e.message });
            allMatch = false;
        }
    }
    
    console.log('\n' + '='.repeat(60));
    
    if (allMatch) {
        console.log('✅ TOUS LES WIDGETS SONT À JOUR');
        process.exit(0);
    } else {
        console.log('❌ CERTAINS WIDGETS NE SONT PAS À JOUR');
        console.log('\nExécutez : npm run build:taskflow');
        process.exit(1);
    }
}

main();
