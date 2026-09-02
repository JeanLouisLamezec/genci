'use strict';

const notifications = require('./taskflow-notifications.js');

describe('TaskFlowNotifications', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('conserve un succès 4 secondes et une erreur 8 secondes', () => {
    const manager = notifications.createManager({ document });
    manager.show('Enregistré', 'success');
    manager.show('Modification impossible', 'error');

    jest.advanceTimersByTime(3999);
    expect(manager.getVisibleCount()).toBe(2);
    jest.advanceTimersByTime(1);
    expect(manager.getVisibleCount()).toBe(1);
    jest.advanceTimersByTime(4000);
    expect(manager.getVisibleCount()).toBe(0);
  });

  test('peut être fermé immédiatement avec la croix', () => {
    const manager = notifications.createManager({ document });
    const element = manager.show('Erreur lisible', 'error');
    element.querySelector('.tf-notification-close').click();
    expect(manager.getVisibleCount()).toBe(0);
    expect(element.isConnected).toBe(false);
  });

  test('suspend le délai pendant le survol', () => {
    const manager = notifications.createManager({ document });
    const element = manager.show('Erreur lisible', 'error');
    jest.advanceTimersByTime(3000);
    element.dispatchEvent(new MouseEvent('mouseenter'));
    jest.advanceTimersByTime(8000);
    expect(element.isConnected).toBe(true);
    element.dispatchEvent(new MouseEvent('mouseleave'));
    jest.advanceTimersByTime(5000);
    expect(element.isConnected).toBe(false);
  });

  test('dédoublonne un même message et redémarre son délai', () => {
    const manager = notifications.createManager({ document });
    const first = manager.show('Action refusée', 'error');
    jest.advanceTimersByTime(7000);
    const second = manager.show('Action refusée', 'error');
    expect(second).toBe(first);
    expect(manager.getVisibleCount()).toBe(1);
    expect(first.querySelector('.tf-notification-count').textContent).toBe('×2');
    jest.advanceTimersByTime(7999);
    expect(first.isConnected).toBe(true);
    jest.advanceTimersByTime(1);
    expect(first.isConnected).toBe(false);
  });

  test('limite le panneau aux trois messages les plus récents', () => {
    const manager = notifications.createManager({ document });
    manager.show('Un', 'info');
    manager.show('Deux', 'info');
    manager.show('Trois', 'info');
    manager.show('Quatre', 'info');
    expect(manager.getVisibleCount()).toBe(3);
    expect(document.body.textContent).not.toContain('Un');
  });
});
