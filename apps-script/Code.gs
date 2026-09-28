/**
 * シフトログ — Googleカレンダー取り込み・保存用 Apps Script
 *
 * スプレッドシート「シフトログデータ」の 拡張機能 → Apps Script に貼り付けて:
 *   1. 関数「setup」を一度実行（カレンダーとスプレッドシートの権限を承認）
 *   2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分 / アクセスできるユーザー：全員
 *   発行された URL をアプリの 設定 → 連携 に貼ります（他人に教えないこと）。
 *
 * 更新するとき: コードを貼り替えて保存 → setup を実行（権限を承認）→
 *   デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ（URL はそのまま）
 *
 * シート
 *   shifts … 手入力したシフト（1シフト1行）
 *   一覧   … カレンダー分も含めた全シフトと給料（アプリが計算して書き込む。分析用）
 *   config … アプリの設定（A2 に JSON）
 *
 * カレンダーの予定は、勤務先の「キーワード」がタイトルに入っているものだけをアプリに返します。
 */
const SHIFT_SHEET = 'shifts';
const LIST_SHEET = '一覧';
const CFG_SHEET = 'config';
const SHIFT_HEAD = ['id', '日付', '開始', '終了', '勤務先ID', '休憩(分)', 'メモ', '作成日時'];
const LIST_HEAD = ['日付', '曜日', '勤務先', '開始', '終了', '休憩(分)', '実働(時間)', '深夜(時間)', '時給', '給料', '交通費', '支給日', '入力', '状態'];

const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();

function sheet_(name, head) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function cfgSheet_() {
  let sh = ss_().getSheetByName(CFG_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CFG_SHEET);
    sh.getRange('A1').setValue('config (JSON)').setFontWeight('bold');
  }
  return sh;
}

function setup() {
  const sh = sheet_(SHIFT_SHEET, SHIFT_HEAD);
  sh.getRange('A:D').setNumberFormat('@');
  sheet_(LIST_SHEET, LIST_HEAD);
  cfgSheet_();
  const first = ss_().getSheetByName('シート1') || ss_().getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(first);
  CalendarApp.getDefaultCalendar();   // カレンダーの権限を承認させる
  UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });   // 高速読み込み用の権限
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return json_({ ok: true, app: 'shiftlog', version: 2 }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    switch (req.action) {
      case 'load': return json_(load_(req));
      case 'save': return json_(withLock_(() => save_(req)));
      case 'calendars': return json_({ ok: true, calendars: calendars_() });
      case 'addEvent': return json_({ ok: true, event: addEvent_(req) });
      default: return json_({ ok: false, error: 'unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- 読み込み ---------- */
function readConfig_() {
  const v = cfgSheet_().getRange('A2').getValue();
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function readShifts_() {
  const sh = sheet_(SHIFT_SHEET, SHIFT_HEAD);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, SHIFT_HEAD.length).getDisplayValues()
    .filter(r => r[0])
    .map(r => ({ id: r[0], date: r[1], start: r[2], end: r[3], wpId: r[4], brk: r[5] === '' ? null : Number(r[5]), memo: r[6], createdAt: r[7] }));
}
function load_(req) {
  const config = readConfig_();
  const keywords = (req.keywords || keywordsOf_(config)).map(k => String(k).toLowerCase()).filter(Boolean);
  const from = new Date(req.from || Date.now() - 400 * 864e5);
  const to = new Date(req.to || Date.now() + 400 * 864e5);
  const calIds = (req.calendarIds || (config && config.calendarIds) || []);
  return { ok: true, version: 2, config: config, shifts: readShifts_(), events: events_(calIds, keywords, from, to), at: Date.now() };
}
function keywordsOf_(config) {
  const out = [];
  ((config && config.workplaces) || []).forEach(w => (w.keywords || []).forEach(k => out.push(k)));
  return out;
}
function cals_(ids) {
  if (!ids || !ids.length) return [CalendarApp.getDefaultCalendar()];
  return ids.map(id => CalendarApp.getCalendarById(id)).filter(Boolean);
}
function events_(calIds, keywords, from, to) {
  if (!keywords.length) return [];
  try { return eventsFast_(calIds, keywords, from, to); }
  catch (err) { return eventsSlow_(calIds, keywords, from, to); }
}
// Calendar API を直接呼ぶ（カレンダーごとに並列・必要な項目だけ・1回で2500件）ので速い
function eventsFast_(calIds, keywords, from, to) {
  const ids = calIds && calIds.length ? calIds : ['primary'];
  const token = ScriptApp.getOAuthToken();
  const fields = 'items(iCalUID,summary,start,end,status,attendees(self,responseStatus)),nextPageToken,summary';
  const reqs = ids.map(id => ({ id }));
  const url = (r, page) => 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(r.id) + '/events?singleEvents=true&maxResults=2500'
    + '&timeMin=' + encodeURIComponent(from.toISOString()) + '&timeMax=' + encodeURIComponent(to.toISOString())
    + '&fields=' + encodeURIComponent(fields) + (page ? '&pageToken=' + encodeURIComponent(page) : '');
  const out = {};
  let todo = reqs.map(r => ({ r, page: null }));
  for (let round = 0; todo.length && round < 5; round++) {
    const res = UrlFetchApp.fetchAll(todo.map(t => ({ url: url(t.r, t.page), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true })));
    const next = [];
    res.forEach((rs, i) => {
      if (rs.getResponseCode() !== 200) throw new Error('calendar api ' + rs.getResponseCode());
      const j = JSON.parse(rs.getContentText());
      (j.items || []).forEach(ev => {
        if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime) return;   // 終日の予定は除く
        if ((ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) return;
        const title = ev.summary || '';
        const low = title.toLowerCase();
        if (!keywords.some(k => low.indexOf(k) >= 0)) return;
        const st = Date.parse(ev.start.dateTime);
        const id = ev.iCalUID + '@' + st;
        out[id] = { id, t: title, s: st, e: Date.parse(ev.end.dateTime), cal: j.summary || '' };
      });
      if (j.nextPageToken) next.push({ r: todo[i].r, page: j.nextPageToken });
    });
    todo = next;
  }
  return Object.keys(out).map(k => out[k]);
}
// 予備：CalendarApp で1件ずつ（遅い）
function eventsSlow_(calIds, keywords, from, to) {
  const out = [];
  cals_(calIds).forEach(cal => {
    cal.getEvents(from, to).forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const title = ev.getTitle() || '';
      const low = title.toLowerCase();
      if (!keywords.some(k => low.indexOf(k) >= 0)) return;
      const s = ev.getStartTime().getTime();
      out.push({ id: ev.getId() + '@' + s, t: title, s: s, e: ev.getEndTime().getTime(), cal: cal.getName() });
    });
  });
  return out;
}
function calendars_() {
  const def = CalendarApp.getDefaultCalendar().getId();
  return CalendarApp.getAllCalendars().map(c => ({ id: c.getId(), name: c.getName(), color: c.getColor(), primary: c.getId() === def }));
}

/* ---------- 保存 ---------- */
// アプリの状態をまるごと書き込む（手入力のシフトは数百行程度なので全置き換えで十分）
function save_(req) {
  if (req.config) cfgSheet_().getRange('A2').setValue(JSON.stringify(req.config));
  if (req.shifts) {
    const sh = sheet_(SHIFT_SHEET, SHIFT_HEAD);
    sh.getRange('A:D').setNumberFormat('@');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHIFT_HEAD.length).clearContent();
    const rows = req.shifts.map(s => [s.id, s.date, s.start, s.end, s.wpId, s.brk == null ? '' : s.brk, s.memo || '', s.createdAt || '']);
    if (rows.length) sh.getRange(2, 1, rows.length, SHIFT_HEAD.length).setValues(rows);
  }
  if (req.rows) {
    const sh = sheet_(LIST_SHEET, LIST_HEAD);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (req.rows.length) sh.getRange(2, 1, req.rows.length, LIST_HEAD.length).setValues(req.rows);
  }
  return { ok: true, at: Date.now() };
}

// アプリから入れたシフトをカレンダーにも登録する
function addEvent_(req) {
  const cal = req.calendarId ? CalendarApp.getCalendarById(req.calendarId) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('カレンダーが見つかりません');
  const ev = cal.createEvent(req.title, new Date(req.s), new Date(req.e), req.memo ? { description: req.memo } : {});
  const s = ev.getStartTime().getTime();
  return { id: ev.getId() + '@' + s, t: ev.getTitle(), s: s, e: ev.getEndTime().getTime(), cal: cal.getName() };
}
