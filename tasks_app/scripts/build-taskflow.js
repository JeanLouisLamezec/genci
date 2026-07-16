#!/usr/bin/env node
/* ============================================================================
 * build-taskflow.js — Script de build pour TaskFlow
 * ----------------------------------------------------------------------------
 * Ce script injecte le code partagé (taskflow-core.js + taskflow-schema.js +
 * taskflow-bootstrap.js + taskflow-migrations.js) dans chaque widget HTML.
 * 
 * Usage : npm run build:taskflow
 * ============================================================================ */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const SCHEMA_DIR = path.join(CORE_DIR, 'schema');

// Fichiers à injecter
const FILES_TO_INJECT = [
    path.join(CORE_DIR, 'taskflow-core.js'),
    path.join(SCHEMA_DIR, 'taskflow-schema.js'),
    path.join(SCHEMA_DIR, 'taskflow-bootstrap.js'),
    path.join(SCHEMA_DIR, 'taskflow-migrations.js')
];

// Widgets à mettre à jour
const WIDGETS = [
    'kanban.html',
    'gantt.html',
    'plan.html',
    'cra.html',
    'calendar.html',
    'dashboard.html',
    'orgchart.html'
];

// Marqueurs de génération
const START_MARKER = '// <taskflow-core> -- GENERE par scripts/build-taskflow.js, NE PAS EDITER ICI';
const END_MARKER = '// </taskflow-core>';

// Lit le contenu des fichiers à injecter
function readCoreFiles() {
    const contents = [];
    for (const file of FILES_TO_INJECT) {
        if (fs.existsSync(file)) {
            contents.push(fs.readFileSync(file, 'utf8'));
        } else {
            console.warn(`Fichier non trouvé: ${file}`);
        }
    }
    return contents.join('\n\n');
}

// Injecte le code dans un widget HTML
function injectIntoWidget(widgetPath, coreCode) {
    let content = fs.readFileSync(widgetPath, 'utf8');
    
    // Vérifie si les marqueurs existent
    const startIndex = content.indexOf(START_MARKER);
    const endIndex = content.indexOf(END_MARKER);
    
    if (startIndex === -1 || endIndex === -1) {
        console.warn(`  ⚠️  Marqueurs non trouvés dans ${path.basename(widgetPath)} -跳过`);
        return false;
    }
    
    // Construit le bloc à injecter
    const injectionBlock = `${START_MARKER}
${coreCode}
${END_MARKER}`;
    
    // Remplace l'ancien bloc
    const newContent = content.substring(0, startIndex) + injectionBlock + content.substring(endIndex + END_MARKER.length);
    
    // Écrit le fichier mis à jour
    fs.writeFileSync(widgetPath, newContent, 'utf8');
    return true;
}

// Build du bundle navigateur
function buildPlanningBrowser() {
    const buildScript = path.join(__dirname, 'build-planning-browser.js');
    if (fs.existsSync(buildScript)) {
        console.log('🔨 Build du bundle navigateur...\n');
        try {
            require(buildScript);
            console.log('');
        } catch (e) {
            console.warn(`⚠️  Erreur build navigateur: ${e.message}`);
        }
    }
}

// Main
function main() {
    console.log('🔨 Build TaskFlow...\n');
    
    // Build du bundle navigateur en premier
    buildPlanningBrowser();
    
    // Lit les fichiers core
    console.log('📄 Lecture des fichiers core...');
    const coreCode = readCoreFiles();
    console.log(`   ${FILES_TO_INJECT.length} fichiers lus, ${coreCode.length} octets\n`);
    
    // Injecte dans chaque widget
    let successCount = 0;
    for (const widget of WIDGETS) {
        const widgetPath = path.join(ROOT_DIR, widget);
        if (fs.existsSync(widgetPath)) {
            console.log(`📝 Injection dans ${widget}...`);
            if (injectIntoWidget(widgetPath, coreCode)) {
                successCount++;
            }
        } else {
            console.warn(`⚠️  Widget non trouvé: ${widget}`);
        }
    }
    
    console.log(`\n✅ Build terminé: ${successCount}/${WIDGETS.length} widgets mis à jour`);
}

// Exécution
main();
