const DomSecurity = require('./taskflow-dom-security');

describe('TaskFlowDomSecurity', () => {
    test('encode les caracteres actifs dans le texte et les attributs HTML', () => {
        expect(DomSecurity.escapeHtml(`"><img src=x onerror='alert(1)'>&`)).toBe(
            '&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;'
        );
    });

    test('preserve les valeurs ordinaires sans modifier leur contenu fonctionnel', () => {
        expect(DomSecurity.escapeHtml('Projet R&D — phase 2')).toBe('Projet R&amp;D — phase 2');
        expect(DomSecurity.escapeHtml(0)).toBe('0');
        expect(DomSecurity.escapeHtml(null)).toBe('');
    });

    test('conserve la valeur exacte dans un input sans creer de noeud executable', () => {
        const payload = `"><img src=x onerror="globalThis.__xss = true">`;
        document.body.innerHTML =
            `<input id="title" value="${DomSecurity.escapeHtml(payload)}">` +
            `<div id="label">${DomSecurity.escapeHtml(payload)}</div>`;

        expect(document.getElementById('title').value).toBe(payload);
        expect(document.getElementById('label').textContent).toBe(payload);
        expect(document.querySelector('img')).toBeNull();
        expect(globalThis.__xss).toBeUndefined();
    });

    test('conserve une valeur de filtre hostile via un attribut data sans creer de handler', () => {
        const payload = `');globalThis.__xss = true;//\"><img src=x onerror=alert(1)>`;
        document.body.innerHTML =
            `<button id="filter" data-status="${DomSecurity.escapeHtml(payload)}">Filtrer</button>`;

        const button = document.getElementById('filter');
        expect(button.dataset.status).toBe(payload);
        expect(button.getAttribute('onclick')).toBeNull();
        expect(document.querySelector('img')).toBeNull();
        expect(globalThis.__xss).toBeUndefined();
    });

    test('n accepte que les couleurs hexadecimales utilisees par TaskFlow', () => {
        expect(DomSecurity.sanitizeCssColor('#3e5de7', '#94a3b8')).toBe('#3e5de7');
        expect(DomSecurity.sanitizeCssColor('#AABBCC', '#94a3b8')).toBe('#AABBCC');
        expect(DomSecurity.sanitizeCssColor('red;\" onmouseover=\"alert(1)', '#64748b')).toBe('#64748b');
        expect(DomSecurity.sanitizeCssColor(null, 'invalid')).toBe('#94a3b8');
    });

    test('n accepte qu un jeton CSS unique pour les classes persistantes', () => {
        expect(DomSecurity.sanitizeCssClassToken('in-progress', 'todo')).toBe('in-progress');
        expect(DomSecurity.sanitizeCssClassToken('review_2', 'todo')).toBe('review_2');
        expect(DomSecurity.sanitizeCssClassToken('done\" onclick=\"alert(1)', 'todo')).toBe('todo');
        expect(DomSecurity.sanitizeCssClassToken('done selected', 'todo')).toBe('todo');
        expect(DomSecurity.sanitizeCssClassToken(null, 'bad fallback')).toBe('');
    });

    test('convertit les progressions en nombres bornes', () => {
        expect(DomSecurity.sanitizePercentage(42.5)).toBe(42.5);
        expect(DomSecurity.sanitizePercentage(-10)).toBe(0);
        expect(DomSecurity.sanitizePercentage(180)).toBe(100);
        expect(DomSecurity.sanitizePercentage('0\" onmouseover=\"alert(1)', 25)).toBe(25);
        expect(DomSecurity.sanitizePercentage(null, 25)).toBe(0);
    });

    test('restreint les preferences persistantes a une liste fermee', () => {
        const modes = ['priority', 'project', 'assignee', 'status'];
        expect(DomSecurity.sanitizeEnumValue('project', modes, 'priority')).toBe('project');
        expect(DomSecurity.sanitizeEnumValue('<img src=x onerror=alert(1)>', modes, 'priority')).toBe('priority');
        expect(DomSecurity.sanitizeEnumValue(null, modes, 'priority')).toBe('priority');
        expect(DomSecurity.sanitizeEnumValue('unknown', [], 'priority')).toBe('');
    });

    test('n accepte que les references Grist entieres et strictement positives', () => {
        expect(DomSecurity.sanitizeRecordId(42)).toBe('42');
        expect(DomSecurity.sanitizeRecordId('42')).toBe('42');
        expect(DomSecurity.sanitizeRecordId(0)).toBe('');
        expect(DomSecurity.sanitizeRecordId(-1)).toBe('');
        expect(DomSecurity.sanitizeRecordId(1.5)).toBe('');
        expect(DomSecurity.sanitizeRecordId('1);alert(1)//')).toBe('');
        expect(DomSecurity.sanitizeRecordId(Number.MAX_SAFE_INTEGER + 1)).toBe('');
    });
});
