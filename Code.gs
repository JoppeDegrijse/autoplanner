// Autoplanner API, gekoppeld aan de Google Sheet met de tabbladen:
// "Reserveringen" (id, datum, persoon, opmerking, van, tot, eind)
// "Tankbeurten"   (id, datum, persoon, liters, bedrag, kilometerstand)
// "Ritten"        (id, datum, persoon, kmstand)
// "Afrekeningen"  (id, datum, betaler, ontvanger, bedrag, methode)
// "Tankbeurten" krijgt er een kolom bij: vol

// !!! Zet hier dezelfde geheime sleutel als in je huidige script.
const API_KEY = 'VERVANG-DIT-DOOR-JE-EIGEN-SLEUTEL';

const TABS = { reservering: 'Reserveringen', tankbeurt: 'Tankbeurten', rit: 'Ritten', afrekening: 'Afrekeningen' };
const TEXT_COLS = ['datum', 'van', 'tot', 'eind'];   // blijven tekst, zodat Sheets er geen datum/tijd van maakt
const AI_MODEL = 'gemini-2.5-flash';         // de AI-sleutel staat in Script Properties (GEMINI_KEY)

function doGet(e) {
  if (e.parameter.key !== API_KEY) return out({ error: 'Geen toegang' });
  return out({
    reserveringen: readTab(TABS.reservering),
    tankbeurten: readTab(TABS.tankbeurt),
    ritten: readTab(TABS.rit),
    afrekeningen: readTab(TABS.afrekening)
  });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'Ongeldige aanvraag' }); }
  if (body.key !== API_KEY) return out({ error: 'Geen toegang' });

  if (body.action === 'odometer') return out(readOdometer(body.image));
  if (body.action === 'receipt') return out(readReceipt(body.image));

  const tabName = TABS[body.type];
  if (!tabName) return out({ error: 'Onbekend type' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
    if (!sheet) return out({ error: 'Tabblad ontbreekt: ' + tabName });
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    if (body.action === 'add') {
      const id = Utilities.getUuid();
      const data = body.data || {};
      const row = headers.map(h => (h === 'id' ? id : (data[h] !== undefined ? data[h] : '')));
      const r = sheet.getLastRow() + 1;
      headers.forEach((h, i) => { if (TEXT_COLS.indexOf(h) >= 0) sheet.getRange(r, i + 1).setNumberFormat('@'); });
      sheet.getRange(r, 1, 1, row.length).setValues([row]);
      return out({ ok: true, id: id });
    }

    if (body.action === 'delete') {
      const idCol = headers.indexOf('id') + 1;
      const ids = sheet.getRange(1, idCol, sheet.getLastRow(), 1).getValues().flat();
      const rowIndex = ids.indexOf(body.id);
      if (rowIndex < 1) return out({ error: 'Niet gevonden' });
      sheet.deleteRow(rowIndex + 1);
      return out({ ok: true });
    }
    return out({ error: 'Onbekende actie' });
  } finally {
    lock.releaseLock();
  }
}

// Stuurt een foto + vraag naar Google Gemini en geeft de tekst van het antwoord terug.
function askGemini(b64, prompt, asJson) {
  if (!b64) return { error: 'Geen foto ontvangen' };
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) return { error: 'AI-sleutel ontbreekt' };
  const config = { temperature: 0, maxOutputTokens: 1000 };
  if (asJson) config.responseMimeType = 'application/json';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + AI_MODEL + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      generationConfig: config
    })
  });
  const json = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200) {
    return { error: 'AI-fout ' + res.getResponseCode() + (json.error && json.error.message ? ': ' + json.error.message.slice(0, 120) : '') };
  }
  const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  return { text: parts.map(p => p.text || '').join('') };
}

// Kilometerstand van een foto van het dashboard.
function readOdometer(b64) {
  const r = askGemini(b64, 'Dit is een foto van het dashboard van een auto. Lees de totale kilometerstand (de odometer) af, niet de dagteller of trip-teller. Antwoord enkel met het getal in hele kilometers, zonder eenheid. Kan je het niet duidelijk lezen, antwoord dan: ONBEKEND', false);
  if (r.error) return r;
  const m = r.text.replace(/[\s.,]/g, '').match(/\d{3,7}/);
  return m ? { km: parseInt(m[0], 10) } : { error: 'Geen getal herkend' };
}

// Totaalbedrag en liters van een tankbon.
function readReceipt(b64) {
  const r = askGemini(b64, 'Dit is een tankbon of tickettje van een benzinestation. Geef het totaalbedrag in euro en het aantal getankte liters. Antwoord enkel met JSON in dit formaat: {"bedrag": 36.10, "liters": 22.5}. Gebruik null voor wat je niet zeker kan aflezen.', true);
  if (r.error) return r;
  try {
    const j = JSON.parse(r.text.replace(/```json|```/g, '').trim());
    const bedrag = Number(j.bedrag), liters = Number(j.liters);
    if (!(bedrag > 0) && !(liters > 0)) return { error: 'Niets herkend' };
    return { bedrag: bedrag > 0 ? bedrag : null, liters: liters > 0 ? liters : null };
  } catch (e) {
    return { error: 'Geen antwoord begrepen' };
  }
}

// Eenmalig in de editor uitvoeren om toestemming te geven voor externe verbindingen.
function autoriseer() {
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com', { muteHttpExceptions: true });
}

function readTab(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return values.filter(r => r[0] !== '').map(r => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], tz, 'yyyy-MM-dd') : r[i];
    });
    return obj;
  });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
