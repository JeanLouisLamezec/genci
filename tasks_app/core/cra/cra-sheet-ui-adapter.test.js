/**
 * Tests pour l'adaptateur UI du workflow CRA
 */

'use strict';

const { createUiAdapter, USER_MESSAGES } = require('./cra-sheet-ui-adapter');

describe('CRA Sheet UI Adapter', () => {
  let mockService;
  let mockGrist;
  let mockReload;
  let mockNotify;
  let mockSetBusy;
  let actorMemberId;
  let adapter;

  beforeEach(() => {
    actorMemberId = 123;
    mockService = {
      submitSheet: jest.fn(),
      withdrawSheet: jest.fn(),
      validateSheet: jest.fn(),
      rejectSheet: jest.fn(),
      openManagerCorrection: jest.fn(),
      updateManagerActual: jest.fn(),
      revalidateSheet: jest.fn()
    };

    mockGrist = {
      docApi: {
        fetchTable: jest.fn(),
        applyUserActions: jest.fn()
      }
    };

    mockReload = jest.fn();
    mockNotify = jest.fn();
    mockSetBusy = jest.fn();

    adapter = createUiAdapter({
      service: mockService,
      grist: mockGrist,
      getActorMemberId: () => actorMemberId,
      reload: mockReload,
      notify: mockNotify,
      setBusy: mockSetBusy
    });
  });

  describe('createUiAdapter', () => {
    test('lance une erreur sans options requises', () => {
      expect(() => createUiAdapter()).toThrow('options requises');
      expect(() => createUiAdapter({})).toThrow('options requises');
      expect(() => createUiAdapter({ service: mockService })).toThrow('options requises');
      expect(() => createUiAdapter({ service: mockService, grist: mockGrist })).toThrow('options requises');
    });

    test('retourne un adaptateur avec toutes les méthodes', () => {
      expect(adapter.submit).toBeDefined();
      expect(adapter.withdraw).toBeDefined();
      expect(adapter.validate).toBeDefined();
      expect(adapter.reject).toBeDefined();
      expect(adapter.openCorrection).toBeDefined();
      expect(adapter.updateManagerActual).toBeDefined();
      expect(adapter.revalidate).toBeDefined();
    });
  });

  describe('submit', () => {
    test('appelle le bon service', async () => {
      mockService.submitSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.submit(456);

      expect(mockService.submitSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          grist: mockGrist,
          actorMemberId: 123,
          sheetId: 456
        })
      );
    });

    test('utilise getActorMemberId() comme acteur', async () => {
      mockService.submitSheet.mockResolvedValue({ success: true, code: 'OK' });
      const customGetActor = jest.fn(() => 789);
      const customAdapter = createUiAdapter({
        service: mockService,
        grist: mockGrist,
        getActorMemberId: customGetActor,
        reload: mockReload,
        notify: mockNotify,
        setBusy: mockSetBusy
      });

      await customAdapter.submit(456);

      expect(mockService.submitSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          actorMemberId: 789
        })
      );
    });

    test('rejette sans acteur', async () => {
      actorMemberId = null;
      const result = await adapter.submit(456);

      expect(result.success).toBe(false);
      expect(result.code).toBe('ACTOR_NOT_IDENTIFIED');
      expect(mockService.submitSheet).not.toHaveBeenCalled();
    });

    test('appelle setBusy(true) puis setBusy(false)', async () => {
      mockService.submitSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.submit(456);

      expect(mockSetBusy).toHaveBeenCalledWith(true);
      expect(mockSetBusy).toHaveBeenCalledWith(false);
    });

    test('recharge après succès', async () => {
      mockService.submitSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.submit(456);

      expect(mockReload).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'workflow-success',
          immediate: true
        })
      );
    });

    test('affiche un message de succès', async () => {
      mockService.submitSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.submit(456);

      expect(mockNotify).toHaveBeenCalledWith(
        'Semaine soumise à votre responsable',
        'success'
      );
    });
  });

  describe('withdraw', () => {
    test('appelle le bon service', async () => {
      mockService.withdrawSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.withdraw(456);

      expect(mockService.withdrawSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          grist: mockGrist,
          actorMemberId: 123,
          sheetId: 456
        })
      );
    });

    test('recharge après succès', async () => {
      mockService.withdrawSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.withdraw(456);

      expect(mockReload).toHaveBeenCalled();
    });

    test('affiche "Soumission retirée"', async () => {
      mockService.withdrawSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.withdraw(456);

      expect(mockNotify).toHaveBeenCalledWith('Soumission retirée', 'success');
    });
  });

  describe('validate', () => {
    test('appelle le bon service', async () => {
      mockService.validateSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.validate(456);

      expect(mockService.validateSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          grist: mockGrist,
          actorMemberId: 123,
          sheetId: 456
        })
      );
    });

    test('fournit un timestamp', async () => {
      mockService.validateSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.validate(456);

      const call = mockService.validateSheet.mock.calls[0][0];
      expect(call.nowUnixSeconds).toBeDefined();
      expect(typeof call.nowUnixSeconds).toBe('number');
    });
  });

  describe('reject', () => {
    test('transmet le motif trimé', async () => {
      mockService.rejectSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.reject(456, '  Motif avec espaces  ');

      expect(mockService.rejectSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          rejectReason: 'Motif avec espaces'
        })
      );
    });

    test('rejette sans motif', async () => {
      const result = await adapter.reject(456, '');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_REJECT_REASON');
      expect(mockService.rejectSheet).not.toHaveBeenCalled();
    });

    test('recharge après succès', async () => {
      mockService.rejectSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.reject(456, 'Motif');

      expect(mockReload).toHaveBeenCalled();
    });
  });

  describe('openCorrection', () => {
    test('transmet le motif trimé', async () => {
      mockService.openManagerCorrection.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.openCorrection(456, '  Correction  ');

      expect(mockService.openManagerCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          correctionReason: 'Correction'
        })
      );
    });

    test('rejette sans motif', async () => {
      const result = await adapter.openCorrection(456, '');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_CORRECTION_REASON');
    });
  });

  describe('revalidate', () => {
    test('fournit un timestamp', async () => {
      mockService.revalidateSheet.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.revalidate(456);

      const call = mockService.revalidateSheet.mock.calls[0][0];
      expect(call.nowUnixSeconds).toBeDefined();
    });
  });

  describe('updateManagerActual', () => {
    test('préserve zéro', async () => {
      mockService.updateManagerActual.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.updateManagerActual(456, 789, 0);

      expect(mockService.updateManagerActual).toHaveBeenCalledWith(
        expect.objectContaining({
          hours: 0
        })
      );
    });

    test('accepte des heures positives', async () => {
      mockService.updateManagerActual.mockResolvedValue({ success: true, code: 'OK' });

      await adapter.updateManagerActual(456, 789, 3.5);

      expect(mockService.updateManagerActual).toHaveBeenCalledWith(
        expect.objectContaining({
          hours: 3.5
        })
      );
    });

    test('rejette heures négatives', async () => {
      await expect(adapter.updateManagerActual(456, 789, -1))
        .rejects.toThrow('heures invalides');
    });

    test('rejette null', async () => {
      await expect(adapter.updateManagerActual(456, 789, null))
        .rejects.toThrow('hours requis');
    });

    test('rejette chaîne vide', async () => {
      await expect(adapter.updateManagerActual(456, 789, ''))
        .rejects.toThrow('hours requis');
    });
  });

  describe('double-clic', () => {
    test('bloque le double-clic sur la même feuille', async () => {
      mockService.submitSheet.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ success: true, code: 'OK' }), 100);
      }));

      const promise1 = adapter.submit(456);
      const promise2 = adapter.submit(456);

      const result2 = await promise2;
      expect(result2.success).toBe(false);
      expect(result2.code).toBe('OPERATION_PENDING');

      await promise1;
    });
  });

  describe('busy toujours libéré', () => {
    test('libère busy même en cas d\'erreur', async () => {
      mockService.submitSheet.mockRejectedValue(new Error('API error'));

      try {
        await adapter.submit(456);
      } catch (e) {
        // Erreur attendue
      }

      expect(mockSetBusy).toHaveBeenCalledWith(false);
    });
  });

  describe('reload après WORKFLOW_STATE_CHANGED', () => {
    test('recharge après WORKFLOW_STATE_CHANGED', async () => {
      mockService.submitSheet.mockResolvedValue({
        success: false,
        code: 'WORKFLOW_STATE_CHANGED',
        reason: 'État modifié'
      });

      await adapter.submit(456);

      expect(mockReload).toHaveBeenCalled();
    });
  });

  describe('reload après WORKFLOW_POSTCONDITION_FAILED', () => {
    test('recharge après WORKFLOW_POSTCONDITION_FAILED', async () => {
      mockService.submitSheet.mockResolvedValue({
        success: false,
        code: 'WORKFLOW_POSTCONDITION_FAILED',
        reason: 'Postcondition échouée'
      });

      await adapter.submit(456);

      expect(mockReload).toHaveBeenCalled();
    });
  });

  describe('messages utilisateur', () => {
    test('utilise les codes pour les messages', async () => {
      actorMemberId = null;
      await adapter.submit(456);

      expect(mockNotify).toHaveBeenCalledWith(
        USER_MESSAGES.ACTOR_NOT_IDENTIFIED,
        'error'
      );
    });

    test('loge l\'erreur technique sans stack', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      
      mockService.submitSheet.mockResolvedValue({
        success: false,
        code: 'TIMESHEET_VALIDATION_FAILED',
        validation: {
          errors: [{ code: 'DAILY_CAPACITY_EXCEEDED', message: 'Capacité dépassée' }]
        }
      });

      await adapter.submit(456);

      expect(consoleError).toHaveBeenCalled();
      const errorCall = consoleError.mock.calls[0][0];
      expect(errorCall).toContain('Échec opération');

      consoleError.mockRestore();
    });
  });

  describe('aucun reload inutile', () => {
    test('ne recharge pas pour un refus local de paramètre', async () => {
      const result = await adapter.reject(456, '');

      expect(result.success).toBe(false);
      expect(mockReload).not.toHaveBeenCalled();
    });
  });
});
