/**
 * CRA Civil Date - Conversion de dates Grist vers dates civiles Europe/Paris
 *
 * Ce module centralise la conversion des timestamps Grist vers des dates civiles
 * dans le fuseau horaire Europe/Paris, évitant les décalages d'un jour causés
 * par la conversion UTC.
 *
 * @module core/cra/cra-civil-date
 */

'use strict';

const CRA_TIME_ZONE = 'Europe/Paris';

/**
 * Normalise un timestamp Grist (secondes) ou JavaScript (millisecondes) vers millisecondes
 * @param {*} value - Valeur à normaliser
 * @returns {number|null} Timestamp en millisecondes ou null
 */
function normalizeDateMs(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    // Timestamp Grist en secondes (< 100 milliards) ou JS en millisecondes
    return Math.abs(value) < 100000000000
      ? value * 1000
      : value;
  }

  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    // Déjà une date ISO, retourner tel quel
    return value;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Formate un timestamp en date civile ISO (YYYY-MM-DD) dans le fuseau spécifié
 * @param {number} ms - Timestamp en millisecondes
 * @param {string} timeZone - Fuseau horaire IANA
 * @returns {string|null} Date ISO ou null
 */
function formatCivilDate(ms, timeZone = CRA_TIME_ZONE) {
  if (ms === null || typeof ms === 'string') {
    return ms;
  }

  if (!Number.isFinite(ms)) {
    return null;
  }

  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(new Date(ms));

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Convertit une date Grist vers sa date civile Europe/Paris
 * @param {*} value - Date Grist (timestamp secondes, millisecondes, ISO string)
 * @param {string} timeZone - Fuseau horaire (défaut: Europe/Paris)
 * @returns {string|null} Date ISO YYYY-MM-DD ou null
 */
function gristDateToIso(value, timeZone = CRA_TIME_ZONE) {
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  const ms = normalizeDateMs(value);

  if (ms === null || typeof ms === 'string') {
    return ms;
  }

  return formatCivilDate(ms, timeZone);
}

/**
 * Calcule le lundi de la semaine civile contenant la date donnée
 * @param {*} value - Date Grist
 * @param {string} timeZone - Fuseau horaire
 * @returns {string|null} Date ISO du lundi (YYYY-MM-DD) ou null
 */
function getWeekStartIso(value, timeZone = CRA_TIME_ZONE) {
  const dateIso = gristDateToIso(value, timeZone);

  if (!dateIso || typeof dateIso === 'string' === false) {
    return dateIso;
  }

  const [year, month, day] = dateIso.split('-').map(Number);

  // Créer une date UTC pour le calcul du lundi
  const date = new Date(Date.UTC(year, month - 1, day));

  // Calculer l'offset pour revenir au lundi (0 = dimanche, 1 = lundi, etc.)
  const offset = (date.getUTCDay() + 6) % 7;

  date.setUTCDate(date.getUTCDate() - offset);

  // Formater en ISO
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Calcule le lundi de la semaine en millisecondes
 * @param {*} value - Date Grist
 * @param {string} timeZone - Fuseau horaire
 * @returns {number|null} Timestamp du lundi en millisecondes ou null
 */
function mondayOf(value, timeZone = CRA_TIME_ZONE) {
  const dateIso = gristDateToIso(value, timeZone);

  if (!dateIso) {
    return null;
  }

  const [year, month, day] = dateIso.split('-').map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  const offset = (date.getUTCDay() + 6) % 7;

  date.setUTCDate(date.getUTCDate() - offset);
  date.setUTCHours(0, 0, 0, 0);

  return date.getTime();
}

module.exports = {
  CRA_TIME_ZONE,
  normalizeDateMs,
  formatCivilDate,
  gristDateToIso,
  getWeekStartIso,
  mondayOf
};
