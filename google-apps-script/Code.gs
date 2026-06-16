/**
 * 決鬥帳本 - Google 試算表後端
 *
 * 設定步驟：
 * 1. 新建 Google 試算表
 * 2. 擴充功能 → Apps Script，貼上此檔案
 * 3. 修改下方 TOKEN
 * 4. 部署 → 新增部署 → 網頁應用程式
 *    - 執行身分：我
 *    - 誰可以存取：任何人
 * 5. 複製網址到 config.js 的 googleApiUrl
 * 6. 將 TOKEN 填入 config.js 的 googleToken
 */

const TOKEN = '請改成你自己的密碼';
const SHEET_NAME = 'entries';

function doGet(e) {
  try {
    if (!checkToken(e.parameter.token)) {
      return jsonOut({ ok: false, error: 'token 無效' });
    }
    return jsonOut({ ok: true, entries: getEntries() });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!checkToken(body.token)) {
      return jsonOut({ ok: false, error: 'token 無效' });
    }

    const action = body.action;
    if (action === 'list') {
      return jsonOut({ ok: true, entries: getEntries() });
    }
    if (action === 'upsert') {
      upsertEntry(body.entry);
      return jsonOut({ ok: true, entries: getEntries() });
    }
    if (action === 'delete') {
      deleteEntry(body.id);
      return jsonOut({ ok: true, entries: getEntries() });
    }
    if (action === 'bulkReplace') {
      bulkReplace(body.entries || []);
      return jsonOut({ ok: true, entries: getEntries() });
    }

    return jsonOut({ ok: false, error: '未知 action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function checkToken(token) {
  return token && token === TOKEN;
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['id', 'date', 'type', 'note', 'scores', 'createdAt']);
  }
  return sheet;
}

function getEntries() {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, date, type, note, scoresJson, createdAt] = rows[i];
    if (!id) continue;
    entries.push({
      id: String(id),
      date: String(date),
      type: String(type),
      note: note ? String(note) : '',
      scores: scoresJson ? JSON.parse(scoresJson) : {},
      createdAt: Number(createdAt) || 0,
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

function findRowById(sheet, id) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function upsertEntry(entry) {
  const sheet = getSheet();
  const row = [
    entry.id,
    entry.date,
    entry.type,
    entry.note || '',
    JSON.stringify(entry.scores || {}),
    entry.createdAt || Date.now(),
  ];
  const rowIndex = findRowById(sheet, entry.id);
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, 6).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteEntry(id) {
  const sheet = getSheet();
  const rowIndex = findRowById(sheet, id);
  if (rowIndex > 0) sheet.deleteRow(rowIndex);
}

function bulkReplace(entries) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  entries.forEach((entry) => upsertEntry(entry));
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
