// -----------------------------------------------------------------------------
// Texts the container produces, in the four languages of the Gladys interface.
// German says "du", Spanish "usted" (test/i18n.test.js checks the four
// languages, the lengths and the German form). Brand names stay as they are.
// -----------------------------------------------------------------------------

// Connection status shown in the Configuration screen (≤ 200 characters).
export const STATUS = {
  notConfigured: {
    en: 'Enter the e-mail and the password of your intuis Connect account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte intuis Connect.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines intuis-Connect-Kontos ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta intuis Connect.',
  },
  credentials: {
    en: 'intuis refused the e-mail or the password: check them, then save the configuration.',
    fr: 'intuis refuse l’e-mail ou le mot de passe : vérifiez-les, puis enregistrez la configuration.',
    de: 'intuis lehnt die E-Mail-Adresse oder das Passwort ab: Prüfe beide und speichere die Konfiguration.',
    es: 'intuis rechaza el correo o la contraseña: compruébelos y guarde la configuración.',
  },
  unreachable: {
    en: 'The intuis cloud does not answer: new attempt in 5 minutes.',
    fr: 'Le cloud intuis ne répond pas : nouvel essai dans 5 minutes.',
    de: 'Die intuis-Cloud antwortet nicht: neuer Versuch in 5 Minuten.',
    es: 'La nube de intuis no responde: nuevo intento en 5 minutos.',
  },
  rateLimited: {
    en: 'intuis asks to slow down: the next readings wait 15 minutes.',
    fr: 'intuis demande de ralentir : les prochaines lectures attendent 15 minutes.',
    de: 'intuis bittet um weniger Anfragen: Die nächsten Abfragen warten 15 Minuten.',
    es: 'intuis pide reducir las consultas: las próximas lecturas esperan 15 minutos.',
  },
  noHome: {
    en: 'Signed in, but this intuis account has no home with rooms.',
    fr: 'Connecté, mais ce compte intuis n’a aucun logement avec des pièces.',
    de: 'Angemeldet, aber dieses intuis-Konto hat kein Zuhause mit Räumen.',
    es: 'Sesión iniciada, pero esta cuenta intuis no tiene ninguna vivienda con habitaciones.',
  },
  publishFailed: {
    en: 'Gladys refused the list of devices: see the integration logs.',
    fr: 'Gladys a refusé la liste des appareils : consultez les journaux de l’intégration.',
    de: 'Gladys hat die Geräteliste abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'Gladys ha rechazado la lista de dispositivos: consulte los registros de la integración.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// Messages of the commands, the action button and the scene action (≤ 200).
export const MESSAGES = {
  connected: {
    en: (homes, rooms) => `Connected to intuis: ${homes} home(s), ${rooms} room(s).`,
    fr: (homes, rooms) => `Connecté à intuis : ${homes} logement(s), ${rooms} pièce(s).`,
    de: (homes, rooms) => `Mit intuis verbunden: ${homes} Zuhause, ${rooms} Raum/Räume.`,
    es: (homes, rooms) => `Conectado a intuis: ${homes} vivienda(s), ${rooms} habitación(es).`,
  },
  offRefused: {
    en: 'Turning a room off is left to the intuis app: use the frost protection preset.',
    fr: 'L’arrêt d’une pièce reste dans l’appli intuis : utilisez le mode hors-gel.',
    de: 'Das Ausschalten eines Raums bleibt der intuis-App vorbehalten: Nutze den Frostschutz.',
    es: 'Apagar una habitación se hace en la app intuis: use el modo antihielo.',
  },
  unknownValue: {
    en: 'This value is not offered by intuis.',
    fr: 'Cette valeur n’est pas proposée par intuis.',
    de: 'Diesen Wert bietet intuis nicht an.',
    es: 'intuis no ofrece este valor.',
  },
  unknownRoom: {
    en: 'Choose a room of the intuis integration.',
    fr: 'Choisissez une pièce de l’intégration intuis.',
    de: 'Wähle einen Raum der intuis-Integration aus.',
    es: 'Elija una habitación de la integración intuis.',
  },
  invalidTemperature: {
    en: 'The setpoint must be between 7 and 30 °C.',
    fr: 'La consigne doit être comprise entre 7 et 30 °C.',
    de: 'Die Solltemperatur muss zwischen 7 und 30 °C liegen.',
    es: 'La consigna debe estar entre 7 y 30 °C.',
  },
  homeMode: {
    en: (mode) => `Home mode: ${mode}.`,
    fr: (mode) => `Mode de la maison : ${mode}.`,
    de: (mode) => `Hausmodus: ${mode}.`,
    es: (mode) => `Modo de la casa: ${mode}.`,
  },
};

// Names of the presets in the messages and the widget (≤ 24).
export const PRESET_NAMES = {
  en: { 0: 'Schedule', 1: 'Frost protection', 2: 'Away' },
  fr: { 0: 'Planning', 1: 'Hors-gel', 2: 'Absence' },
  de: { 0: 'Zeitplan', 1: 'Frostschutz', 2: 'Abwesend' },
  es: { 0: 'Programación', 1: 'Antihielo', 2: 'Ausencia' },
};

/** A text of a multi-language table, in a language (French by default). */
export const pick = (table, language) => table[language] ?? table.fr;
