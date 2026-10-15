'use strict';

/**
 * Calendrier civil TaskFlow.
 *
 * Une date de feuille/CRA n'est jamais une durée de 24 heures : c'est un jour
 * du calendrier grégorien. Temporal.PlainDate traite donc les transitions DST,
 * les années bissextiles et les fins de mois sans dépendre de l'horloge.
 */

const DEFAULT_TIME_ZONE = 'Europe/Paris';

function getTemporal() {
  if (typeof globalThis !== 'undefined') {
    if (globalThis.Temporal && globalThis.Temporal.PlainDate) return globalThis.Temporal;
    if (globalThis.temporal && globalThis.temporal.Temporal) return globalThis.temporal.Temporal;
  }

  // Le bundle navigateur charge le fichier UMD avant ce module. En Node (tests
  // et outils), on charge la même implémentation depuis la dépendance npm.
  if (typeof require === 'function') {
    // Le build navigateur remplace explicitement cet import par le global UMD
    // chargé dans cra.html. Garder un import statique est important : Node et
    // Jest utilisent exactement le même moteur que le navigateur.
    const temporal = require('@js-temporal/polyfill').Temporal;
    if (temporal && temporal.PlainDate) return temporal;
  }

  throw new Error('Temporal indisponible : le polyfill calendrier n’a pas été chargé.');
}

function resolveTimeZone(timeZone) {
  if (timeZone) return timeZone;
  try {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimeZone) return browserTimeZone;
  } catch (error) {
    // En environnement sans Intl complet, conserver le fuseau du document
    // historique plutôt qu'un UTC silencieux.
  }
  return DEFAULT_TIME_ZONE;
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    const plainDate = getTemporal().PlainDate.from(value);
    return plainDate.toString() === value ? plainDate : null;
  } catch (error) {
    return null;
  }
}

function formatIsoDate(plainDate) {
  return plainDate ? plainDate.toString() : null;
}

function addDays(isoDate, days) {
  if (!Number.isInteger(days)) return null;
  const plainDate = parseIsoDate(isoDate);
  return plainDate ? plainDate.add({ days }).toString() : null;
}

function startOfIsoWeek(isoDate) {
  const plainDate = parseIsoDate(isoDate);
  return plainDate ? plainDate.subtract({ days: plainDate.dayOfWeek - 1 }).toString() : null;
}

function isIsoWeekStart(isoDate) {
  const plainDate = parseIsoDate(isoDate);
  return Boolean(plainDate && plainDate.dayOfWeek === 1);
}

function isoDateFromEpochMs(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) return null;
  try {
    return getTemporal().Instant.fromEpochMilliseconds(epochMs)
      .toZonedDateTimeISO(resolveTimeZone(timeZone))
      .toPlainDate()
      .toString();
  } catch (error) {
    return null;
  }
}

function epochMsAtLocalMidnight(isoDate, timeZone) {
  const plainDate = parseIsoDate(isoDate);
  if (!plainDate) return null;
  try {
    return plainDate.toZonedDateTime({
      timeZone: resolveTimeZone(timeZone),
      plainTime: '00:00'
    }).epochMilliseconds;
  } catch (error) {
    return null;
  }
}

/**
 * Convertit un jour civil en timestamp Grist. Les colonnes Date de Grist
 * sont des jours sans fuseau ; leur représentation historique est minuit UTC.
 * Ce choix ne doit donc jamais dépendre du fuseau du navigateur de l'éditeur.
 */
function epochMsAtUtcMidnight(isoDate) {
  const plainDate = parseIsoDate(isoDate);
  if (!plainDate) return null;
  try {
    return plainDate.toZonedDateTime({
      timeZone: 'UTC',
      plainTime: '00:00'
    }).epochMilliseconds;
  } catch (error) {
    return null;
  }
}

function isoDateFromGrist(value, timeZone = DEFAULT_TIME_ZONE) {
  if (typeof value === 'string') return parseIsoDate(value) ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Les anciennes valeurs du document ont été écrites à minuit Europe/Paris.
    // Fixer le fuseau documentaire évite qu'un éditeur hors de France voie le
    // dimanche précédent, sans casser les données historiques.
    return isoDateFromEpochMs(value * 1000, timeZone);
  }
  if (value instanceof Date) return isoDateFromEpochMs(value.getTime(), timeZone);
  return null;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  parseIsoDate,
  formatIsoDate,
  addDays,
  startOfIsoWeek,
  isIsoWeekStart,
  isoDateFromEpochMs,
  epochMsAtLocalMidnight,
  epochMsAtUtcMidnight,
  isoDateFromGrist
};
