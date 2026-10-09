'use strict';

const CraExportSettings = require('../export/cra-export-settings.js');

describe('CRA Export Settings', () => {
  test('normalise la configuration absente vers les valeurs historiques', () => {
    expect(CraExportSettings.normalizeSettings(null)).toEqual({
      id: null,
      projectColumnIds: [],
      logoAttachmentIds: [],
      logoPosition: 'bottom-center'
    });
  });

  test('limite, déduplique et sécurise les identifiants de colonnes Projects', () => {
    expect(CraExportSettings.normalizeColumnIds([
      'Code_Analytique', 'Code_Analytique', 'nom', 'bad-id', 'A', 'B', 'C', 'D'
    ])).toEqual(['Code_Analytique', 'A', 'B']);
  });

  test('conserve uniquement la première pièce jointe logo', () => {
    expect(CraExportSettings.attachmentValue(['L', 19, 20])).toEqual(['L', 19]);
  });

  test('convertit les anciennes positions droite vers les nouvelles positions', () => {
    expect(CraExportSettings.normalizeSettings({ logoPosition: 'top-right' }).logoPosition).toBe('top-left');
    expect(CraExportSettings.normalizeSettings({ logoPosition: 'bottom-right' }).logoPosition).toBe('bottom-center');
  });

  test('résout les champs configurés sur les métadonnées Projects disponibles', () => {
    const settings = { projectColumnIds: ['Code_Analytique', 'inconnue'] };
    const available = [
      { id: 'Code_Analytique', label: 'Code analytique', type: 'Text' },
      { id: 'Centre', label: 'Centre', type: 'Text' }
    ];
    expect(CraExportSettings.resolveProjectColumns(settings, available)).toEqual([
      { id: 'Code_Analytique', label: 'Code analytique', type: 'Text' }
    ]);
  });

  test('liste les colonnes Projects exportables depuis les métadonnées Grist', async () => {
    const grist = {
      docApi: {
        fetchTable: jest.fn(async tableId => tableId === '_grist_Tables'
          ? { id: [12], tableId: ['Projects'] }
          : {
              id: [1, 2, 3, 4],
              parentId: [12, 12, 12, 12],
              colId: ['nom', 'Code_Analytique', 'documents', 'budget'],
              label: ['Nom', 'Code analytique', 'Documents', 'Budget'],
              type: ['Text', 'Text', 'Attachments', 'Numeric']
            })
      }
    };

    await expect(CraExportSettings.listProjectColumns(grist)).resolves.toEqual([
      { id: 'budget', label: 'Budget', type: 'Numeric' },
      { id: 'Code_Analytique', label: 'Code analytique', type: 'Text' }
    ]);
  });

  test('crée la configuration singleton avec les valeurs normalisées', async () => {
    const applyUserActions = jest.fn(async () => undefined);
    const grist = {
      docApi: {
        listTables: jest.fn(async () => ['CRAExportSettings']),
        fetchTable: jest.fn(async () => ({ id: [] })),
        applyUserActions
      }
    };

    await CraExportSettings.save(grist, {
      projectColumnIds: ['Code_Analytique', 'budget'],
      logoAttachmentIds: [44, 45],
      logoPosition: 'top-left'
    });

    expect(applyUserActions).toHaveBeenCalledWith([
      ['AddRecord', 'CRAExportSettings', null, expect.objectContaining({
        projectColumns: '["Code_Analytique","budget"]',
        logo: ['L', 44],
        logoPosition: 'top-left'
      })]
    ]);
  });
});
