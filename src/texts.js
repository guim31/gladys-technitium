// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the sentence
// of the "Read the statistics" scene action, scene action errors. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './technitium/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address and API token of your Technitium server in the configuration.',
    fr: "Saisissez l'adresse et le jeton d'API de votre serveur Technitium dans la configuration.",
    de: 'Gib die Adresse und das API-Token deines Technitium-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección y el token de API de su servidor Technitium en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.2 or http://192.168.1.2:5380',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou http://192.168.1.2:5380',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder http://192.168.1.2:5380',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o http://192.168.1.2:5380',
  },
};

// One short explanation per error kind (src/technitium/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API token refused: create a new one',
    fr: "jeton d'API refusé : créez-en un nouveau",
    de: 'API-Token abgelehnt: Erstelle ein neues',
    es: 'token de API rechazado: cree uno nuevo',
  },
  [ERROR_KINDS.DENIED]: {
    en: 'access denied: the token user lacks a permission',
    fr: "accès refusé : il manque une permission à l'utilisateur du jeton",
    de: 'Zugriff verweigert: Dem Benutzer des Tokens fehlt eine Berechtigung',
    es: 'acceso denegado: al usuario del token le falta un permiso',
  },
  [ERROR_KINDS.NOT_TECHNITIUM]: {
    en: 'no Technitium server at this address (port 5380?)',
    fr: 'aucun serveur Technitium à cette adresse (port 5380 ?)',
    de: 'kein Technitium-Server unter dieser Adresse (Port 5380?)',
    es: 'no hay ningún servidor Technitium en esta dirección (¿puerto 5380?)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, one line per server.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    on: 'blocking on',
    off: 'blocking off',
    paused: (minutes) => `paused, ${minutes} min left`,
    leases: (count) => `${count} DHCP lease(s)`,
    update: (version) => `update ${version} available`,
  },
  fr: {
    ok: 'OK',
    on: 'blocage actif',
    off: 'blocage désactivé',
    paused: (minutes) => `en pause, encore ${minutes} min`,
    leases: (count) => `${count} bail(s) DHCP`,
    update: (version) => `mise à jour ${version} disponible`,
  },
  de: {
    ok: 'OK',
    on: 'Blockierung aktiv',
    off: 'Blockierung aus',
    paused: (minutes) => `pausiert, noch ${minutes} min`,
    leases: (count) => `${count} DHCP-Lease(s)`,
    update: (version) => `Update ${version} verfügbar`,
  },
  es: {
    ok: 'OK',
    on: 'bloqueo activo',
    off: 'bloqueo desactivado',
    paused: (minutes) => `en pausa, quedan ${minutes} min`,
    leases: (count) => `${count} concesión(es) DHCP`,
    update: (version) => `actualización ${version} disponible`,
  },
};

const number = (value, locale) => new Intl.NumberFormat(locale).format(value);

// The sentence of the "Read the statistics" scene action (a message, a TTS).
export const STATS_TEXT = {
  en: {
    sentence: ({ queries, blocked, percent, lastHour }) =>
      `In the last 24 hours, ${number(queries, 'en')} DNS queries, ${number(blocked, 'en')} blocked (${number(percent, 'en')} %). Last hour: ${number(lastHour, 'en')} queries.`,
  },
  fr: {
    sentence: ({ queries, blocked, percent, lastHour }) =>
      `Sur les dernières 24 heures, ${number(queries, 'fr')} requêtes DNS, dont ${number(blocked, 'fr')} bloquées (${number(percent, 'fr')} %). Dernière heure : ${number(lastHour, 'fr')} requêtes.`,
  },
  de: {
    sentence: ({ queries, blocked, percent, lastHour }) =>
      `In den letzten 24 Stunden ${number(queries, 'de')} DNS-Anfragen, davon ${number(blocked, 'de')} blockiert (${number(percent, 'de')} %). Letzte Stunde: ${number(lastHour, 'de')} Anfragen.`,
  },
  es: {
    sentence: ({ queries, blocked, percent, lastHour }) =>
      `En las últimas 24 horas, ${number(queries, 'es')} consultas DNS, de ellas ${number(blocked, 'es')} bloqueadas (${number(percent, 'es')} %). Última hora: ${number(lastHour, 'es')} consultas.`,
  },
};

// Errors of the scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Technitium server is configured.',
    fr: "Aucun serveur Technitium n'est configuré.",
    de: 'Kein Technitium-Server ist konfiguriert.',
    es: 'No hay ningún servidor Technitium configurado.',
  },
  unknownServer: {
    en: 'This Technitium server is no longer in the configuration.',
    fr: "Ce serveur Technitium n'est plus dans la configuration.",
    de: 'Dieser Technitium-Server ist nicht mehr in der Konfiguration.',
    es: 'Este servidor Technitium ya no está en la configuración.',
  },
  failed: {
    en: 'No Technitium server accepted the command.',
    fr: "Aucun serveur Technitium n'a accepté la commande.",
    de: 'Kein Technitium-Server hat den Befehl angenommen.',
    es: 'Ningún servidor Technitium ha aceptado la orden.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
