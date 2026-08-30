const selector = require('./time-view-selector');

describe('TaskFlowTimeViewSelector', () => {
  test('normalise les horizons communs et leurs libellés', () => {
    expect(selector.normalizeViews(['week', 'month', 'quarter'])).toEqual([
      { value: 'week', label: 'Sem' },
      { value: 'month', label: 'Mois' },
      { value: 'quarter', label: 'Trim' }
    ]);
  });

  test('rend le choix actif et transmet le nouvel horizon', () => {
    document.body.innerHTML = '<div id="selector"></div>';
    const onChange = jest.fn();
    const container = document.getElementById('selector');

    selector.render(container, {
      views: ['week', 'month'],
      value: 'month',
      activeClass: 'on',
      buttonClass: 'btn',
      onChange
    });

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['Sem', 'Mois']);
    expect(buttons[1].classList.contains('on')).toBe(true);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

    buttons[0].click();
    expect(onChange).toHaveBeenCalledWith('week');
  });
});
