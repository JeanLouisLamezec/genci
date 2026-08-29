'use strict';

const permissions = require('./taskflow-permissions.js');

function fixture(actorMemberId = 1, overrides = {}) {
  const team = overrides.team || [
    { id: 1, nom: 'Admin', gristUserId: 101, actif: true, estAdmin: true },
    { id: 2, nom: 'Manager', gristUserId: 102, actif: true },
    { id: 3, nom: 'CP direct', gristUserId: 103, actif: true, responsable: 2 },
    { id: 4, nom: 'Executant', gristUserId: 104, actif: true, responsable: 3 },
    { id: 5, nom: 'Autre CP', gristUserId: 105, actif: true },
    { id: 6, nom: 'Autre executant', gristUserId: 106, actif: true, responsable: 5 }
  ];
  const projects = overrides.projects || [
    { id: 10, nom: 'Projet direct', responsable: 3 },
    { id: 20, nom: 'Autre projet', responsable: 5 }
  ];
  const tasks = overrides.tasks || [
    { id: 100, titre: 'Tache directe', projet: 10, assignees: ['L', 4] },
    { id: 101, titre: 'Tache non affectee', projet: 10, assignees: ['L', 6] },
    { id: 200, titre: 'Tache etrangere', projet: 20, assignees: ['L', 6] }
  ];
  const actions = overrides.actions || [
    { id: 1000, titre: 'Action propre', task: 100, assignee: 4 },
    { id: 1001, titre: 'Action autre', task: 100, assignee: 6 },
    { id: 2000, titre: 'Action etrangere', task: 200, assignee: 6 },
    { id: 3000, titre: 'Action libre', task: null, assignee: 4 }
  ];
  const member = team.find(m => m.id === actorMemberId);
  const identity = permissions.resolveActorIdentity({
    team,
    currentGristUserId: member ? member.gristUserId : 999
  });
  return permissions.createSnapshot({
    Team: team,
    Projects: projects,
    Tasks: tasks,
    Actions: actions,
    Entites: [{ id: 1, nom: 'Equipe' }],
    Programmes: [{ id: 1, nom: 'Programme' }],
    KanbanSteps: [{ id: 1, nom: 'A faire' }]
  }, identity);
}

function authorize(snapshot, action) {
  return permissions.authorizeMutationBatch(snapshot, [action]);
}

describe('TaskFlow permissions - identité', () => {
  test('associe un gristUserId unique et expose estAdmin', () => {
    const snapshot = fixture(1);
    expect(snapshot.actor.identified).toBe(true);
    expect(snapshot.actor.memberId).toBe(1);
    expect(snapshot.actor.isAdmin).toBe(true);
  });

  test('échoue fermé sur un identifiant dupliqué', () => {
    const team = [
      { id: 1, gristUserId: 101, actif: true },
      { id: 2, gristUserId: 101, actif: true }
    ];
    const identity = permissions.resolveActorIdentity({ team, currentGristUserId: 101 });
    expect(identity.identified).toBe(false);
    expect(identity.status).toBe('GRIST_USER_ID_DUPLICATED');
  });

  test('échoue fermé pour un membre inactif', () => {
    const team = [{ id: 1, gristUserId: 101, actif: false, estAdmin: true }];
    const identity = permissions.resolveActorIdentity({ team, currentGristUserId: 101 });
    expect(identity.identified).toBe(false);
    expect(identity.status).toBe('MEMBER_INACTIVE');
    expect(identity.isAdmin).toBe(false);
  });
});

describe('TaskFlow permissions - projets et tâches', () => {
  test('admin peut tout modifier et supprimer', () => {
    const snapshot = fixture(1);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 200, { titre: 'X' }]).allowed).toBe(true);
    expect(authorize(snapshot, ['RemoveRecord', 'Projects', 20]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Team', 6, { nom: 'X' }]).allowed).toBe(true);
  });

  test('chef de projet agit uniquement dans son projet', () => {
    const snapshot = fixture(3);
    expect(authorize(snapshot, ['AddRecord', 'Tasks', null, { titre: 'X', projet: 10 }]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 100, { titre: 'X' }]).allowed).toBe(true);
    expect(authorize(snapshot, ['RemoveRecord', 'Tasks', 101]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 200, { titre: 'X' }]).allowed).toBe(false);
  });

  test('chef d’équipe agit sur les projets de ses chefs de projet directs', () => {
    const snapshot = fixture(2);
    expect(authorize(snapshot, ['UpdateRecord', 'Projects', 10, { nom: 'X' }]).allowed).toBe(true);
    expect(authorize(snapshot, ['AddRecord', 'Tasks', null, { titre: 'X', projet: 10 }]).allowed).toBe(true);
    expect(authorize(snapshot, ['RemoveRecord', 'Tasks', 100]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Projects', 20, { nom: 'X' }]).allowed).toBe(false);
  });

  test('la relation de management ne remonte pas au-delà du responsable direct', () => {
    const snapshot = fixture(2);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 100, { titre: 'X' }]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Actions', 1000, { titre: 'X' }]).allowed).toBe(true);
    const topManagerTeam = snapshot.tables.Team.map(member => Object.assign({}, member));
    topManagerTeam.push({ id: 7, gristUserId: 107, actif: true });
    topManagerTeam.find(member => member.id === 2).responsable = 7;
    const topSnapshot = fixture(7, { team: topManagerTeam });
    expect(authorize(topSnapshot, ['UpdateRecord', 'Tasks', 100, { titre: 'X' }]).allowed).toBe(false);
  });

  test('exécutant affecté peut modifier mais jamais supprimer une tâche', () => {
    const snapshot = fixture(4);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 100, { dateDebut: 123 }]).allowed).toBe(true);
    expect(authorize(snapshot, ['RemoveRecord', 'Tasks', 100]).allowed).toBe(false);
    expect(authorize(snapshot, ['UpdateRecord', 'Tasks', 101, { titre: 'X' }]).allowed).toBe(false);
  });

  test('exécutant affecté ne peut pas déplacer ni réaffecter une tâche', () => {
    const snapshot = fixture(4);
    expect(permissions.canUpdateTask(snapshot, snapshot.tables.Tasks[0], { statut: 'en_cours' }).allowed).toBe(true);
    expect(permissions.canUpdateTask(snapshot, snapshot.tables.Tasks[0], { projet: 99 }).code).toBe('TASK_SCOPE_FIELDS_ADMIN_OR_MANAGER_REQUIRED');
    expect(permissions.canUpdateTask(snapshot, snapshot.tables.Tasks[0], { assignees: ['L', 4, 5] }).allowed).toBe(false);
  });

  test('seul un administrateur peut transférer la responsabilité d’un projet', () => {
    const owner = fixture(3);
    const admin = fixture(1);
    expect(permissions.canUpdateProject(owner, owner.tables.Projects[0], { responsable: 4 }).code).toBe('PROJECT_RESPONSIBLE_CHANGE_ADMIN_REQUIRED');
    expect(permissions.canUpdateProject(admin, admin.tables.Projects[0], { responsable: 4 }).allowed).toBe(true);
  });

  test('équipe, organisation, programme et étapes Kanban sont admin uniquement', () => {
    const snapshot = fixture(2);
    expect(authorize(snapshot, ['UpdateRecord', 'Team', 3, { nom: 'X' }]).code).toBe('ADMIN_REQUIRED');
    expect(authorize(snapshot, ['UpdateRecord', 'Entites', 1, { nom: 'X' }]).allowed).toBe(false);
    expect(authorize(snapshot, ['UpdateRecord', 'Programmes', 1, { nom: 'X' }]).allowed).toBe(false);
    expect(authorize(snapshot, ['UpdateRecord', 'KanbanSteps', 1, { nom: 'X' }]).allowed).toBe(false);
  });
});

describe('TaskFlow permissions - actions', () => {
  test('préfiltre les tâches liables avec la même portée que la création d’action', () => {
    expect(permissions.listActionTaskCandidates(fixture(1)).map(task => task.id)).toEqual([100, 101, 200]);
    expect(permissions.listActionTaskCandidates(fixture(3)).map(task => task.id)).toEqual([100, 101]);
    expect(permissions.listActionTaskCandidates(fixture(2)).map(task => task.id)).toEqual([100, 101]);
    expect(permissions.listActionTaskCandidates(fixture(4)).map(task => task.id)).toEqual([100]);
    expect(permissions.listActionTaskCandidates(fixture(6)).map(task => task.id)).toEqual([101, 200]);
  });

  test('exécutant affecté crée uniquement une action assignée à lui-même', () => {
    const snapshot = fixture(4);
    expect(authorize(snapshot, ['AddRecord', 'Actions', null, { titre: 'X', task: 100, assignee: 4 }]).allowed).toBe(true);
    expect(authorize(snapshot, ['AddRecord', 'Actions', null, { titre: 'X', task: 100, assignee: 6 }]).code).toBe('ACTION_CREATE_FORBIDDEN');
    expect(authorize(snapshot, ['AddRecord', 'Actions', null, { titre: 'X', task: 200, assignee: 4 }]).allowed).toBe(false);
  });

  test('propriétaire modifie et supprime son action, même sans tâche', () => {
    const snapshot = fixture(4);
    expect(authorize(snapshot, ['UpdateRecord', 'Actions', 1000, { titre: 'X' }]).allowed).toBe(true);
    expect(authorize(snapshot, ['RemoveRecord', 'Actions', 1000]).allowed).toBe(true);
    expect(authorize(snapshot, ['UpdateRecord', 'Actions', 3000, { titre: 'X' }]).allowed).toBe(true);
  });

  test('propriétaire ne peut ni réassigner ni rattacher à une tâche étrangère', () => {
    const snapshot = fixture(4);
    expect(authorize(snapshot, ['UpdateRecord', 'Actions', 1000, { assignee: 6 }]).code).toBe('ACTION_REASSIGN_FORBIDDEN');
    expect(authorize(snapshot, ['UpdateRecord', 'Actions', 1000, { task: 200 }]).code).toBe('ACTION_TASK_CHANGE_FORBIDDEN');
  });

  test('chef de projet et chef d’équipe agissent sur les actions de leur périmètre', () => {
    expect(authorize(fixture(3), ['UpdateRecord', 'Actions', 1001, { assignee: 4 }]).allowed).toBe(true);
    expect(authorize(fixture(2), ['RemoveRecord', 'Actions', 1001]).allowed).toBe(true);
    expect(authorize(fixture(2), ['UpdateRecord', 'Actions', 2000, { titre: 'X' }]).allowed).toBe(false);
  });
});

describe('TaskFlow permissions - lots atomiques', () => {
  test('refuse tout le lot dès qu’une tâche est hors périmètre', () => {
    const result = permissions.authorizeMutationBatch(fixture(4), [
      ['UpdateRecord', 'Tasks', 100, { dateDebut: 1 }],
      ['UpdateRecord', 'Tasks', 200, { dateDebut: 1 }]
    ]);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('TASK_OUTSIDE_SCOPE');
    expect(result.deniedIndex).toBe(1);
    expect(result.resourceLabel).toBe('Tache etrangere');
  });

  test('autorise un lot complet dans le même périmètre', () => {
    const result = permissions.authorizeMutationBatch(fixture(3), [
      ['UpdateRecord', 'Tasks', 100, { dateDebut: 1 }],
      ['UpdateRecord', 'Tasks', 101, { dateDebut: 1 }]
    ]);
    expect(result.allowed).toBe(true);
  });

  test('échoue fermé lorsque l’acteur n’est pas identifié', () => {
    const snapshot = permissions.createSnapshot({ Tasks: [{ id: 1, titre: 'X' }] }, {
      identified: false,
      status: 'TEAM_ASSOCIATION_REQUIRED'
    });
    const result = authorize(snapshot, ['UpdateRecord', 'Tasks', 1, { titre: 'Y' }]);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('TEAM_ASSOCIATION_REQUIRED');
  });
});
