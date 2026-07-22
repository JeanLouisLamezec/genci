/**
 * CRA Export - Test d'intégration navigateur
 * 
 * Vérifie que les quatre modules d'export se chargent séquentiellement
 * dans le même contexte sans produire d'erreur de redéclaration.
 */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

describe('CRA Export - Intégration navigateur', () => {
  let sandbox;
  
  beforeEach(() => {
    sandbox = {
      globalThis: {},
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      Buffer: Buffer,
      module: { exports: {} },
      exports: {},
      require: require
    };
  });
  
  function loadScript(filePath) {
    const fullPath = path.join(__dirname, filePath);
    const code = fs.readFileSync(fullPath, 'utf-8');
    vm.runInNewContext(code, sandbox);
  }
  
  it('charge séquentiellement les quatre modules sans erreur de redéclaration', () => {
    expect(() => {
      loadScript('cra-export-model.js');
      loadScript('cra-export-pdf.js');
      loadScript('cra-export-csv.js');
      loadScript('cra-export-orchestrator.js');
    }).not.toThrow();
  });
  
  it('expose CraExportModel dans globalThis après chargement', () => {
    loadScript('cra-export-model.js');
    
    expect(sandbox.globalThis.CraExportModel).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportModel.buildReport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportModel.normalizeScope).toBe('function');
    expect(typeof sandbox.globalThis.CraExportModel.validateDateRange).toBe('function');
  });
  
  it('expose CraExportPdf dans globalThis après chargement', () => {
    loadScript('cra-export-pdf.js');
    
    expect(sandbox.globalThis.CraExportPdf).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportPdf.createDocumentDefinition).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.download).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.buildFilename).toBe('function');
  });
  
  it('expose CraExportCsv dans globalThis après chargement', () => {
    loadScript('cra-export-csv.js');
    
    expect(sandbox.globalThis.CraExportCsv).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportCsv.serialize).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.download).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.buildFilename).toBe('function');
  });
  
  it('expose CraExportOrchestrator dans globalThis après chargement', () => {
    loadScript('cra-export-orchestrator.js');
    
    expect(sandbox.globalThis.CraExportOrchestrator).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportOrchestrator.getFormatOptions).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.prepareExport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.download).toBe('function');
  });
  
  it('charge les quatre modules et vérifie leur présence simultanée', () => {
    loadScript('cra-export-model.js');
    loadScript('cra-export-pdf.js');
    loadScript('cra-export-csv.js');
    loadScript('cra-export-orchestrator.js');
    
    expect(sandbox.globalThis.CraExportModel).toBeDefined();
    expect(sandbox.globalThis.CraExportPdf).toBeDefined();
    expect(sandbox.globalThis.CraExportCsv).toBeDefined();
    expect(sandbox.globalThis.CraExportOrchestrator).toBeDefined();
    
    expect(typeof sandbox.globalThis.CraExportModel).toBe('object');
    expect(typeof sandbox.globalThis.CraExportPdf).toBe('object');
    expect(typeof sandbox.globalThis.CraExportCsv).toBe('object');
    expect(typeof sandbox.globalThis.CraExportOrchestrator).toBe('object');
  });
  
  it('ne produit aucune collision de constantes DATE_ISO_REGEX', () => {
    loadScript('cra-export-model.js');
    loadScript('cra-export-pdf.js');
    loadScript('cra-export-csv.js');
    loadScript('cra-export-orchestrator.js');
    
    expect(sandbox.globalThis.CraExportModel).toBeDefined();
    expect(sandbox.globalThis.CraExportPdf).toBeDefined();
    expect(sandbox.globalThis.CraExportCsv).toBeDefined();
    expect(sandbox.globalThis.CraExportOrchestrator).toBeDefined();
  });
  
  it('permet d\'obtenir les options de format depuis l\'orchestrateur', () => {
    loadScript('cra-export-model.js');
    loadScript('cra-export-pdf.js');
    loadScript('cra-export-csv.js');
    loadScript('cra-export-orchestrator.js');
    
    const options = sandbox.globalThis.CraExportOrchestrator.getFormatOptions();
    
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBe(2);
    expect(options[0].id).toBeDefined();
    expect(options[0].label).toBeDefined();
    expect(options[0].description).toBeDefined();
  });
  
  it('exporte CommonJS pour chaque module', () => {
    const modelModule = require('./cra-export-model.js');
    const pdfModule = require('./cra-export-pdf.js');
    const csvModule = require('./cra-export-csv.js');
    const orchestratorModule = require('./cra-export-orchestrator.js');
    
    expect(modelModule).toBeDefined();
    expect(typeof modelModule.buildReport).toBe('function');
    
    expect(pdfModule).toBeDefined();
    expect(typeof pdfModule.download).toBe('function');
    
    expect(csvModule).toBeDefined();
    expect(typeof csvModule.download).toBe('function');
    
    expect(orchestratorModule).toBeDefined();
    expect(typeof orchestratorModule.getFormatOptions).toBe('function');
  });
});
