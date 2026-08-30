/* ==========================================================================
 * plan-filter-scope.js — Applique les filtres aux contributions avant regroupement
 * ========================================================================== */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlanFilterScope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function selected(values) {
    return new Set((Array.isArray(values) ? values : []).map(String));
  }

  function createMemberPredicate(filters, team) {
    var state = filters || {};
    var assignees = selected(state.assignee);
    var entities = selected(state.team);
    var members = new Map((team || []).map(function(member) {
      return [String(member.id), member];
    }));

    return function(memberId) {
      var id = String(memberId);
      if (assignees.size && !assignees.has(id)) return false;
      if (entities.size) {
        var member = members.get(id);
        if (!member || !entities.has(String(member.entite))) return false;
      }
      return true;
    };
  }

  function filterCharges(charges, filters, team) {
    var acceptsMember = createMemberPredicate(filters, team);
    return (charges || []).filter(function(charge) {
      return charge && acceptsMember(charge.teamId);
    });
  }

  function scopeCanonData(canonData, visibleTaskIds, filters) {
    var data = canonData || {};
    var tasks = data.tasks || [];
    var taskIds = visibleTaskIds instanceof Set
      ? visibleTaskIds
      : new Set((visibleTaskIds || tasks.map(function(task) { return task.id; })).map(Number));
    var acceptsMember = createMemberPredicate(filters, data.team || []);
    var acceptsTask = function(taskId) { return taskIds.has(Number(taskId)); };

    return Object.assign({}, data, {
      tasks: tasks.filter(function(task) { return acceptsTask(task.id); }),
      team: (data.team || []).filter(function(member) { return acceptsMember(member.id); }),
      assignments: (data.assignments || []).filter(function(assignment) {
        return acceptsTask(assignment.tache) && acceptsMember(assignment.membre);
      }),
      timeEntries: (data.timeEntries || []).filter(function(entry) {
        return acceptsTask(entry.taskId) && acceptsMember(entry.memberId);
      }),
      dailyCapacities: (data.dailyCapacities || []).filter(function(capacity) {
        return acceptsMember(capacity.membre);
      })
    });
  }

  return {
    createMemberPredicate: createMemberPredicate,
    filterCharges: filterCharges,
    scopeCanonData: scopeCanonData
  };
});
