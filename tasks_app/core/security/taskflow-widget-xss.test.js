const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WIDGETS_WITH_EDITABLE_TITLES = ['gantt.html', 'kanban.html', 'calendar.html'];
const WIDGETS_WITH_SHARED_RENDER_SECURITY = [
    'gantt.html',
    'kanban.html',
    'calendar.html',
    'cra.html',
    'dashboard.html',
    'plan.html'
];

function widgetSource(widget) {
    return fs.readFileSync(path.join(__dirname, '..', '..', widget), 'utf8');
}

describe('protection XSS des panneaux de tâches et actions', () => {
    test.each(WIDGETS_WITH_EDITABLE_TITLES)('%s utilise l encodeur partage', (widget) => {
        const source = widgetSource(widget);
        expect(source).toContain('TaskFlowDomSecurity.escapeHtml(value)');
    });

    test.each(WIDGETS_WITH_EDITABLE_TITLES)('%s ne reinjecte pas un tag dans un gestionnaire inline', (widget) => {
        const source = widgetSource(widget);
        expect(source).not.toMatch(/remove(?:Action)?Tag\([^)]*escapeHtml\s*\(/);
    });

    test('les suppressions de tags utilisent uniquement un index numerique', () => {
        const gantt = fs.readFileSync(path.join(__dirname, '..', '..', 'gantt.html'), 'utf8');
        const kanban = fs.readFileSync(path.join(__dirname, '..', '..', 'kanban.html'), 'utf8');
        const calendar = fs.readFileSync(path.join(__dirname, '..', '..', 'calendar.html'), 'utf8');

        expect(gantt).toContain('onclick="removeTagAt(');
        expect(kanban).toContain('onclick="removeActionTagAt(');
        expect(calendar).toContain('onclick="removeTagAt(');
    });
});

describe('protection XSS des autres widgets de rendu', () => {
    test.each(WIDGETS_WITH_SHARED_RENDER_SECURITY)('%s embarque le module de securite DOM', (widget) => {
        expect(widgetSource(widget)).toContain('TaskFlowDomSecurity');
    });

    test('CRA encode les commentaires indisponibilite et les messages de chargement', () => {
        const source = widgetSource('cra.html');
        expect(source).toContain("esc(ind.label || 'Indispo')");
        expect(source).toContain("esc(message || 'Chargement…')");
        expect(source).toContain('safeSheetStatusClass(status)');
        expect(source).not.toContain("' + status + '\">' + status + '");
    });

    test('Dashboard transporte les statuts dans un attribut data sans les injecter dans du JavaScript', () => {
        const source = widgetSource('dashboard.html');
        expect(source).toContain('data-dashboard-filter-action="toggle-status"');
        expect(source).toContain('data-filter-value="${escapeHtml(s.value)}"');
        expect(source).toContain("origin.closest('[data-dashboard-filter-action]')");
        expect(source).not.toContain("toggleFilterStatut('${s.value}')");
        expect(source).not.toContain("toggleFilterStatut('${v}')");
        expect(source).not.toContain('onclick="toggleFilterStatut(');
    });

    test('Dashboard et Plan valident les couleurs persistantes avant les styles inline', () => {
        const dashboard = widgetSource('dashboard.html');
        const plan = widgetSource('plan.html');
        expect(dashboard).toContain('TaskFlowDomSecurity.sanitizeCssColor(value, fallback)');
        expect(plan).toContain('TaskFlowDomSecurity.sanitizeCssColor(value, fallback)');
        expect(dashboard).not.toContain("style=\"background:${m.couleur||'#4f46e5'}\"");
        expect(plan).not.toContain("style=\"background:' + p.couleur + '\"");
    });

    test('Organigramme encode aussi les apostrophes dans les attributs HTML', () => {
        const source = widgetSource('orgchart.html');
        expect(source).toContain(".replace(/'/g, '&#39;')");
        expect(source).toContain('TaskFlowDomSecurity.sanitizeCssClassToken(value, fallback)');
        expect(source).toContain("safeClassToken(niveau, 'unite')");
        expect(source).not.toContain("esc(niveau || '')");
    });

    test('Kanban transporte les valeurs persistantes de colonnes via dataset', () => {
        const source = widgetSource('kanban.html');
        expect(source).toContain('data-column-key="${escapeHtml(String(col.key))}"');
        expect(source).toContain('renameStatusColumn(column.dataset.columnKey, renameControl)');
        expect(source).toContain('openCreateActionPanelForColumn(column.dataset.columnKey)');
        expect(source).toContain('const colKey = evt.to?.dataset?.columnKey ?? null;');
        expect(source).not.toContain("renameStatusColumn('${col.key}')");
        expect(source).not.toContain("openCreateActionPanelForColumn('${col.key}')");
        expect(source).not.toContain('id="col-${col.key}"');
    });

    test('les puces de filtres Kanban ne generent plus de JavaScript avec leurs valeurs', () => {
        const source = widgetSource('kanban.html');
        expect(source).toContain('data-filter-chip-value="${escapeHtml(String(val))}"');
        expect(source).toContain('removeButton.dataset.filterChipValue');
        expect(source).not.toContain("onclick=\"removeFilterChip('${type}', ${v})\"");
    });

    test('les filtres Calendrier utilisent des attributs encodes et des listeners', () => {
        const source = widgetSource('calendar.html');
        expect(source).toContain('data-calendar-filter-value="${escapeHtml(String(p.id))}"');
        expect(source).toContain("option.addEventListener('click'");
        expect(source).toContain('Number(option.dataset.calendarFilterValue)');
        expect(source).not.toContain("onclick=\"toggleFilterValue('project', ${p.id})\"");
        expect(source).not.toContain("onclick=\"toggleFilterValue('${type}', ${val})\"");
    });

    test('le diagnostic Kanban encode les identifiants de schema', () => {
        const source = widgetSource('kanban.html');
        expect(source).toContain('inspection.missingTables.map(escapeHtml).join');
        expect(source).toContain("escapeHtml(dup.table) + '.' + escapeHtml(dup.canonicalColumn)");
        expect(source).toContain("message += '<li>' + escapeHtml(col) + '</li>'");
    });

    test.each(WIDGETS_WITH_EDITABLE_TITLES)(
        '%s borne les progressions avant de les inserer dans le rendu',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain('TaskFlowDomSecurity.sanitizePercentage(value, fallback)');
            expect(source).toContain('safePercentage(data.progression)');
        }
    );

    test.each(WIDGETS_WITH_EDITABLE_TITLES)(
        '%s restreint le mode de couleur lu depuis localStorage',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain("const COLOR_MODES = ['priority', 'project', 'assignee', 'status'];");
            expect(source).toMatch(/sanitizeEnumValue\(localStorage\.getItem\('taskflow_(?:gantt|kanban|calendar)_colormode'\), COLOR_MODES, 'priority'\)/);
            expect(source).toContain("sanitizeEnumValue(mode, COLOR_MODES, 'priority')");
        }
    );

    test('Gantt valide les couleurs de projet dans la liste et la chronologie', () => {
        const source = widgetSource('gantt.html');
        expect(source).toContain("safeColor(row.color, '#64748b')");
        expect(source).not.toContain('escapeHtml(row.color)');
        expect(source).not.toContain("row.color || '#64748b'");
    });

    test.each(['gantt.html', 'calendar.html'])(
        '%s valide le statut utilise comme classe de sous-tache',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain('TaskFlowDomSecurity.sanitizeCssClassToken(value, fallback)');
            expect(source).toContain("safeClassToken(k.statut, 'todo')");
            expect(source).not.toMatch(/prereq-badge[^\n]*(?:\(k\.statut\s*\|\||\$\{k\.statut\s*\|\|)/);
        }
    );

    test.each(['gantt.html', 'calendar.html'])(
        '%s ne reinjecte pas l identifiant JSON d une checklist dans un handler',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain('data-subtask-index=');
            expect(source).toContain("querySelectorAll('.subtask-item[data-subtask-index]')");
            expect(source).not.toMatch(/(?:toggleSubtask|editSubtask|removeSubtask)\([^\n]*(?:st\.id|\$\{st\.id\})/);
        }
    );

    test.each(['gantt.html', 'calendar.html'])(
        '%s transporte les references de panneau via data et un listener delegue',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
            expect(source).toContain('data-panel-action="remove-assignee"');
            expect(source).toContain('data-panel-action="toggle-assignee"');
            expect(source).toContain('data-panel-action="remove-dependency"');
            expect(source).toContain('data-panel-action="toggle-dependency"');
            expect(source).toContain("origin?.closest('[data-panel-action]')");
            expect(source).toContain("container.removeEventListener('click', container.__taskFlowPanelActionHandler)");
            expect(source).not.toContain('onclick="event.stopPropagation();removeAssignee(');
            expect(source).not.toContain('onclick="event.stopPropagation();removeDependency(');
            expect(source).not.toContain('onclick="toggleAssignee(');
            expect(source).not.toContain('onclick="toggleDependency(');
        }
    );

    test('Gantt ne construit plus les actions de sa liste avec des identifiants inline', () => {
        const source = widgetSource('gantt.html');
        expect(source).toContain('data-list-action="open-project"');
        expect(source).toContain('data-list-action="toggle-project"');
        expect(source).toContain('data-list-action="open-task"');
        expect(source).toContain('data-list-action="toggle-task"');
        expect(source).toContain('function bindGanttTaskListActions(container)');
        expect(source).toContain('container.__taskFlowListActionHandler = handler');
        expect(source).not.toContain('onclick="openProjectPanel(');
        expect(source).not.toContain('onclick="openTaskPanel(');
        expect(source).not.toContain('onclick="event.stopPropagation();toggleExpand(');
    });

    test.each(['gantt.html', 'calendar.html'])(
        '%s delegue aussi couleurs projet, charges et creation de sous-tache',
        widget => {
            const source = widgetSource(widget);
            expect(source).toContain('data-panel-action="set-project-color"');
            expect(source).toContain('data-panel-action="create-subtask"');
            expect(source).toContain('data-panel-change="update-charge"');
            expect(source).toContain("origin?.closest('[data-panel-change]')");
            expect(source).toContain("container.removeEventListener('change', container.__taskFlowPanelChangeHandler)");
            expect(source).not.toContain('onclick="event.stopPropagation();setProjectColor(');
            expect(source).not.toContain('onchange="updateCharge(');
            expect(source).not.toContain('onclick="openCreateTaskWithParent(');
        }
    );

    test('Kanban delegue les actions de carte avec des identifiants valides', () => {
        const source = widgetSource('kanban.html');
        expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
        expect(source).toContain('data-card-action="open-action"');
        expect(source).toContain('data-card-action="set-progress"');
        expect(source).toContain('function bindKanbanCardActions(container)');
        expect(source).toContain('container.__taskFlowCardActionHandler = handler');
        expect(source).toContain('(progressElement || evt.currentTarget).getBoundingClientRect()');
        expect(source).not.toContain('onclick="openActionPanel(');
        expect(source).not.toContain('onclick="event.stopPropagation();setActionCardProgress(');
    });

    test('CRA delegue les cellules et les actions de feuille sans JavaScript genere', () => {
        const source = widgetSource('cra.html');
        expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
        expect(source).toContain('data-cra-change="set-cell"');
        expect(source).toContain('data-cra-action="validate-sheet"');
        expect(source).toContain('data-cra-action="open-correction"');
        expect(source).toContain('function bindCraDynamicActions(container)');
        expect(source).toContain('container.__taskFlowCraChangeHandler = changeHandler');
        expect(source).not.toContain('onchange="setCell(');
        expect(source).not.toContain('onclick="validerFeuille(');
        expect(source).not.toContain('onclick="rejeterFeuille(');
        expect(source).not.toContain('onclick="CraWorkflowIntegration.openCorrection(');
        expect(source).not.toContain('onclick="enterManagerCorrection(');
        expect(source).not.toContain('onclick="revalidateSheet(');
    });

    test('Plan delegue ses editions sans interpoler les references dans du JavaScript', () => {
        const source = widgetSource('plan.html');
        expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
        expect(source).toContain('data-plan-change="set-charge"');
        expect(source).toContain('data-plan-change="reassign-charge"');
        expect(source).toContain('data-plan-change="set-capacity"');
        expect(source).toContain('data-plan-action="remove-indispo"');
        expect(source).toContain('data-plan-action="add-indispo"');
        expect(source).toContain('function bindPlanEditorActions(container)');
        expect(source).toContain('container.__taskFlowPlanChangeHandler = changeHandler');
        expect(source).toContain('container.__taskFlowPlanClickHandler = clickHandler');
        expect(source).not.toContain('onchange="setCharge(');
        expect(source).not.toContain('onchange="if(this.value)reassignCharge(');
        expect(source).not.toContain('onchange="setDates(');
        expect(source).not.toContain('onchange="setCapacity(');
        expect(source).not.toContain('onclick="removeIndispo(');
        expect(source).not.toContain('onclick="addIndispo(');
    });

    test('Organigramme delegue les editions et actions de son panneau', () => {
        const source = widgetSource('orgchart.html');
        expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
        expect(source).toContain('data-org-change="save-entity"');
        expect(source).toContain('data-org-change="save-person"');
        expect(source).toContain('data-org-change="set-identity"');
        expect(source).toContain('data-org-action="add-subentity"');
        expect(source).toContain('data-org-action="delete-person"');
        expect(source).toContain('function bindOrgchartPanelActions(panel)');
        expect(source).toContain('panel.__taskFlowOrgchartChangeHandler = changeHandler');
        expect(source).toContain('panel.__taskFlowOrgchartClickHandler = clickHandler');
        expect(source).not.toContain('onchange="ocSaveE(');
        expect(source).not.toContain('onchange="ocSaveP(');
        expect(source).not.toContain('onchange="ocSetIdentity(');
        expect(source).not.toContain('onclick="ocAddSous(');
        expect(source).not.toContain('onclick="ocAddPers(');
        expect(source).not.toContain('onclick="ocDelE(');
        expect(source).not.toContain('onclick="ocDelP(');
    });

    test('Dashboard delegue ses filtres et ses actions de tache avec des references validees', () => {
        const source = widgetSource('dashboard.html');
        expect(source).toContain('TaskFlowDomSecurity.sanitizeRecordId(value)');
        expect(source).toContain('data-dashboard-filter-action="toggle-project"');
        expect(source).toContain('data-dashboard-filter-action="toggle-assignee"');
        expect(source).toContain('data-dashboard-filter-action="toggle-status"');
        expect(source).toContain('data-dashboard-task-action="select-task"');
        expect(source).toContain('data-dashboard-task-action="mark-done"');
        expect(source).toContain('function bindDashboardFilterActions(container)');
        expect(source).toContain('function bindDashboardTaskActions(container)');
        expect(source).toContain('container.__taskFlowDashboardFilterHandler = handler');
        expect(source).toContain('container.__taskFlowDashboardTaskHandler = handler');
        expect(source).not.toContain('onclick="toggleFilterProjet(');
        expect(source).not.toContain('onclick="toggleFilterAssigne(');
        expect(source).not.toContain('onclick="toggleFilterStatut(');
        expect(source).not.toContain('onclick="selectTask(');
        expect(source).not.toContain('onclick="markDone(');
    });

    test('Dashboard delegue aussi son editeur de composants et valide ses options', () => {
        const source = widgetSource('dashboard.html');
        expect(source).toContain('data-dashboard-edit-action="update-title"');
        expect(source).toContain('data-dashboard-edit-action="update-config"');
        expect(source).toContain('data-dashboard-edit-action="add-component"');
        expect(source).toContain('data-dashboard-edit-action="plan-shift"');
        expect(source).toContain('function bindDashboardEditorActions(container)');
        expect(source).toContain('Object.prototype.hasOwnProperty.call(CATALOG, type)');
        expect(source).toContain('field.options.some(([value]) => String(value) === String(control.value))');
        expect(source).toContain('container.__taskFlowDashboardEditorClickHandler = clickHandler');
        expect(source).not.toContain('oninput="updateCompTitle(');
        expect(source).not.toContain('onchange="updateCompConfig(');
        expect(source).not.toContain('onchange="updateCompFilterField(');
        expect(source).not.toContain('onchange="updateCompFilterValue(');
        expect(source).not.toContain('onclick="planChargeShift(');
        expect(source).not.toContain('onclick="planChargeReset(');
    });

    test.each(WIDGETS_WITH_SHARED_RENDER_SECURITY.concat('orgchart.html'))(
        '%s conserve des scripts inline syntaxiquement valides',
        (widget) => {
            const scripts = Array.from(
                widgetSource(widget).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
                match => match[1]
            ).filter(source => source.trim());

            expect(scripts.length).toBeGreaterThan(0);
            scripts.forEach((source, index) => {
                expect(() => new vm.Script(source, { filename: `${widget}:inline-${index + 1}` })).not.toThrow();
            });
        }
    );
});
