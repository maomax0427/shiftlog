// シフトログ — 画面
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { pad, ymd, toDate, hm2m, m2hm, dim, yen, man, hours, hShort } = C;
  const K = { api: 'shiftlog:api', mode: 'shiftlog:mode', tab: 'shiftlog:tab', hol: 'shiftlog:hol', dirty: 'shiftlog:dirty' };
  const dataKey = () => 'shiftlog:data:' + S.mode;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
  };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const COLORS = ['#139DA6', '#2F6FDB', '#EE5A24', '#D6457A', '#8E5BD9', '#C98A06', '#3A9E3A', '#5F6B7A'];
  const WALLS = [[0, 'なし'], [1030000, '103万円'], [1060000, '106万円（社会保険）'], [1230000, '123万円'], [1300000, '130万円（社会保険）'], [1500000, '150万円（学生）'], [1600000, '160万円']];
  const DEF_CFG = { workplaces: [], goal: 0, wall: 0, weekStart: 0, calendarIds: [], overrides: {}, addToCal: false };
  const now0 = new Date();

  const S = {
    tab: store.get(K.tab, 'cal'),
    api: store.get(K.api, ''),
    mode: store.get(K.mode, ''),       // api / local / demo
    month: new Date(now0.getFullYear(), now0.getMonth(), 1),
    sel: ymd(now0),
    year: now0.getFullYear(),
    payMonth: now0.getMonth(),
    data: null, hol: {}, syncing: false, lastSync: null, dirty: store.get(K.dirty, false),
    stamp: null, form: null, wpForm: null, cals: null,
  };
  if (S.api) S.mode = 'api';

  function loadLocal() {
    const empty = { config: Object.assign({}, DEF_CFG), shifts: [], events: [] };
    if (!S.mode) { S.data = empty; return; }
    const c = store.get(dataKey(), null);
    if (c) S.data = { config: Object.assign({}, DEF_CFG, c.config), shifts: c.shifts || [], events: c.events || [] };
    else if (S.mode === 'demo') { const d = DEMO.make(); S.data = { config: Object.assign({}, DEF_CFG, d.config), shifts: d.shifts, events: d.events }; }
    else S.data = empty;
    S.lastSync = c && c.at || null;
    D = null;
  }
  const cfg = () => S.data.config;
  const wps = () => cfg().workplaces || [];
  const wpById = id => wps().find(w => w.id === id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------------- 派生データ ---------------- */
  let D = null;
  function matchWp(title) {
    const low = String(title || '').toLowerCase();
    return wps().find(w => (w.keywords || []).some(k => k && low.indexOf(String(k).toLowerCase()) >= 0));
  }
  function derive() {
    if (D) return D;
    const today = ymd(new Date()), nowMs = Date.now();
    const ov = cfg().overrides || {};
    const all = [];
    S.data.events.forEach(ev => {
      const o = ov[ev.id] || {};
      const wp = o.wpId ? wpById(o.wpId) : matchWp(ev.t);
      if (!wp) return;
      const st = new Date(ev.s), date = ymd(st), s = st.getHours() * 60 + st.getMinutes();
      all.push({ id: ev.id, src: 'gcal', date, s, e: s + Math.round((ev.e - ev.s) / 60000), wpId: wp.id, brk: o.brk == null ? null : o.brk, title: ev.t, cal: ev.cal, hidden: !!o.hidden, memo: '', endMs: ev.e });
    });
    S.data.shifts.forEach(m => {
      const wp = wpById(m.wpId);
      if (!wp || !m.date || !m.start || !m.end) return;
      const s = hm2m(m.start); let e = hm2m(m.end); if (e <= s) e += 1440;
      const endMs = toDate(m.date).getTime() + e * 60000;
      all.push({ id: m.id, src: 'manual', date: m.date, s, e, wpId: m.wpId, brk: m.brk == null || m.brk === '' ? null : Number(m.brk), memo: m.memo || '', hidden: false, endMs });
    });
    // 同じ勤務先・同じ時間帯のカレンダーの予定があれば、カレンダーを正とする
    const gByDay = {};
    all.forEach(x => { if (x.src === 'gcal' && !x.hidden) (gByDay[x.date + x.wpId] = gByDay[x.date + x.wpId] || []).push(x); });
    all.forEach(x => { if (x.src === 'manual') x.dup = (gByDay[x.date + x.wpId] || []).some(g => g.s < x.e && x.s < g.e); });
    all.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.s - b.s);
    const trSeen = {};
    const byDate = {};
    all.forEach(x => {
      const wp = wpById(x.wpId);
      x.wp = wp;
      x.p = C.pay(x, wp, S.hol);
      x.payDate = C.payDate(x.date, wp);
      x.off = x.hidden || x.dup;
      x.tr = 0;
      if (!x.off && Number(wp.transport) && !trSeen[x.date + x.wpId]) { trSeen[x.date + x.wpId] = 1; x.tr = Number(wp.transport); }
      x.total = x.off ? 0 : x.p.amount + x.tr;
      x.state = x.endMs > nowMs ? 'plan' : x.payDate <= today ? 'recv' : 'earned';
      (byDate[x.date] = byDate[x.date] || []).push(x);
    });
    D = { all, byDate, on: all.filter(x => !x.off), tpl: C.templates(all.filter(x => !x.off && x.date <= today || x.src === 'manual')) };
    if (D.tpl.length < 3) D.tpl = C.templates(all.filter(x => !x.off));
    return D;
  }
  function sumOf(list) {
    const r = { total: 0, recv: 0, earned: 0, plan: 0, work: 0, night: 0, tr: 0, n: 0, days: {} };
    list.forEach(x => { r.total += x.total; r[x.state] += x.total; r.work += x.p.work; r.night += x.p.night; r.tr += x.tr; r.n++; r.days[x.date] = 1; });
    r.dayN = Object.keys(r.days).length;
    r.done = r.recv + r.earned;
    return r;
  }

  /* ---------------- 保存・通信 ---------------- */
  async function api(action, payload) {
    const res = await fetch(S.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '通信エラー');
    return j;
  }
  function range() {
    const y = new Date().getFullYear();
    return { from: new Date(y - 1, 0, 1).getTime(), to: new Date(y + 1, 11, 31, 23, 59).getTime() };
  }
  function keywords() { const k = []; wps().forEach(w => (w.keywords || []).forEach(x => x && k.push(x))); return k; }
  function listRows() {
    const stL = { recv: '受取済', earned: '振込待ち', plan: '予定' };
    return derive().all.map(x => [x.date, WD[toDate(x.date).getDay()], x.wp.name, m2hm(x.s), m2hm(x.e), x.p.brk,
      Math.round(x.p.work / 6) / 10, Math.round(x.p.night / 6) / 10, x.p.wage, x.off ? 0 : x.p.amount, x.tr, x.payDate,
      x.src === 'gcal' ? 'カレンダー' : '手入力', x.hidden ? '除外' : x.dup ? '重複(カレンダー優先)' : stL[x.state]]);
  }
  function saveLocal() {
    store.set(dataKey(), { config: S.data.config, shifts: S.data.shifts, events: S.data.events, at: S.lastSync });
  }
  let pushT = null;
  function persist() {
    D = null;
    saveLocal();
    if (S.mode !== 'api') return;
    S.dirty = true; store.set(K.dirty, true);
    clearTimeout(pushT);
    pushT = setTimeout(push, 700);
  }
  async function push() {
    try {
      await api('save', { config: S.data.config, shifts: S.data.shifts, rows: listRows() });
      S.dirty = false; store.set(K.dirty, false);
    } catch (e) { toast('保存に失敗しました（この端末には保存済み。次の同期で再送します）'); }
  }
  async function sync(quiet) {
    if (S.mode !== 'api' || !S.api || S.syncing) return;
    S.syncing = true; render();
    try {
      if (S.dirty) await push();
      const j = await api('load', Object.assign({ keywords: keywords(), calendarIds: cfg().calendarIds }, range()));
      if (j.config && !S.dirty) S.data.config = Object.assign({}, DEF_CFG, j.config);
      if (!S.dirty) S.data.shifts = j.shifts || [];
      S.data.events = j.events || [];
      S.lastSync = Date.now();
      D = null; saveLocal();
      if (!quiet) toast('カレンダーから ' + derive().all.filter(x => x.src === 'gcal').length + ' 件のシフトを読み込みました');
      // 一覧シートを最新の計算で更新（初回や時給変更のあとも分析用シートがずれないように）
      api('save', { rows: listRows() }).catch(() => { });
    } catch (e) {
      toast('同期できませんでした: ' + e.message);
    }
    S.syncing = false; render();
  }
  async function loadHolidays() {
    const c = store.get(K.hol, null);
    if (c && c.map) { S.hol = c.map; D = null; }
    if (c && Date.now() - c.at < 20 * 864e5) return;
    try {
      const r = await fetch('https://holidays-jp.github.io/api/v1/date.json');
      const map = await r.json();
      S.hol = map; store.set(K.hol, { at: Date.now(), map }); D = null; render();
    } catch (e) { }
  }

  /* ---------------- 共通パーツ ---------------- */
  let toastT = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r=".9" fill="currentColor"/><circle cx="12" cy="14.5" r=".9" fill="currentColor"/></svg>',
    pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.8 7.8 12 12l3.2-4.2M9 12.2h6M9 15h6M12 12v5"/></svg>',
    wp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 5.5 5h13l1.5 5.5"/><path d="M4 10.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 11.9 20 10.5"/><path d="M5.5 13v7h13v-7M10 20v-4h4v4"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    stamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v5l-1.5 3h4.5a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2h4.5L9 8z"/><path d="M5 19h14"/></svg>',
  };
  const TABS = [['cal', 'シフト'], ['pay', '給料'], ['wp', '勤務先'], ['set', '設定']];
  const tRange = x => m2hm(x.s) + '–' + (x.e >= 1440 ? '翌' : '') + m2hm(x.e);
  const tShort = (s, e) => { const f = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return mm ? h + ':' + pad(mm) : String(h); }; return f(s) + '-' + f(e); };
  const mdw = d => { const t = toDate(d); return (t.getMonth() + 1) + '月' + t.getDate() + '日(' + WD[t.getDay()] + ')'; };
  const md = d => { const t = toDate(d); return (t.getMonth() + 1) + '/' + t.getDate(); };
  const stateLabel = { recv: '受取済', earned: '振込待ち', plan: '予定' };

  /* ---------------- シフト（カレンダー） ---------------- */
  function viewCal() {
    const d = derive();
    const y = S.month.getFullYear(), m = S.month.getMonth();
    const mk = y + '-' + pad(m + 1);
    const inMonth = d.on.filter(x => x.date.slice(0, 7) === mk);
    const sm = sumOf(inMonth);
    const perWp = wps().map(w => ({ w, s: sumOf(inMonth.filter(x => x.wpId === w.id)) })).filter(o => o.s.n);
    let h = '<div class="cal-h"><button class="nav-btn" data-act="mprev" aria-label="前の月">' + ICON.prev + '</button>'
      + '<button class="cal-title" data-act="mtoday"><b>' + y + '年' + (m + 1) + '月</b></button>'
      + '<button class="nav-btn" data-act="mnext" aria-label="次の月">' + ICON.next + '</button><span class="sp"></span>'
      + (S.mode === 'api' ? '<button class="icon-btn' + (S.syncing ? ' spin' : '') + '" data-act="sync" aria-label="カレンダーと同期">' + ICON.sync + '</button>' : '')
      + '</div>';
    if (S.mode === 'demo') h += '<div class="banner">お試しデータを表示中<button class="btn sm gray" data-act="gotoSet">はじめる</button></div>';
    if (!wps().length) h += '<div class="banner">まず「勤務先」で時給とカレンダーのキーワードを登録してください<button class="btn sm gray" data-act="newWp">登録</button></div>';

    // 今月のサマリー
    const bar = moneyBar(sm, Math.max(sm.total, 1));
    h += '<div class="card pad sum">'
      + '<div class="sum-top"><div><div class="lbl">' + (m + 1) + '月に働く分の給料</div><div class="big num">' + yen(sm.total) + '</div></div>'
      + '<div class="sum-side num"><b>' + hShort(sm.work) + '</b><span>' + sm.dayN + '日</span></div></div>'
      + bar
      + '<div class="legend3"><span><i class="k-done"></i>働いた ' + yen(sm.done) + '</span><span><i class="k-plan"></i>これから ' + yen(sm.plan) + '</span></div>'
      + (perWp.length > 1 ? '<div class="wp-split">' + perWp.map(o => '<span><i style="background:' + o.w.color + '"></i>' + esc(o.w.name) + ' <b class="num">' + yen(o.s.total) + '</b></span>').join('') + '</div>' : '')
      + '</div>';

    // カレンダー
    const ws = Number(cfg().weekStart) || 0;
    const first = new Date(y, m, 1), lead = (first.getDay() - ws + 7) % 7;
    const cells = Math.ceil((lead + dim(y, m)) / 7) * 7;
    const today = ymd(new Date());
    h += '<div class="card calendar' + (S.stamp ? ' stamping' : '') + '" id="calGrid"><div class="wk">';
    for (let i = 0; i < 7; i++) { const w = (i + ws) % 7; h += '<span class="' + (w === 0 ? 'sun' : w === 6 ? 'sat' : '') + '">' + WD[w] + '</span>'; }
    h += '</div><div class="grid">';
    for (let i = 0; i < cells; i++) {
      const dt = new Date(y, m, 1 - lead + i), ds = ymd(dt), w = dt.getDay();
      const other = dt.getMonth() !== m;
      const list = d.byDate[ds] || [];
      const cls = ['cell', other ? 'other' : '', ds === S.sel ? 'sel' : '', ds === today ? 'today' : '', w === 0 || S.hol[ds] ? 'sun' : w === 6 ? 'sat' : ''].join(' ');
      h += '<button class="' + cls + '" data-act="day" data-d="' + ds + '"><span class="dn">' + dt.getDate() + '</span>';
      list.slice(0, 2).forEach(x => {
        h += '<i class="chip-s' + (x.off ? ' off' : '') + (x.state === 'plan' ? ' plan' : '') + '" style="--c:' + x.wp.color + '">' + m2hm(x.s) + '<br>' + m2hm(x.e) + '</i>';
      });
      if (list.length > 2) h += '<i class="more">+' + (list.length - 2) + '</i>';
      h += '</button>';
    }
    h += '</div></div>';

    // 選んだ日
    if (!S.stamp) h += dayPanel(S.sel);
    return h;
  }
  function moneyBar(sm, max) {
    const pc = v => Math.max(0, Math.min(100, v / max * 100));
    return '<div class="mbar"><i class="k-recv" style="width:' + pc(sm.recv) + '%"></i><i class="k-earned" style="width:' + pc(sm.earned) + '%"></i><i class="k-plan" style="width:' + pc(sm.plan) + '%"></i></div>';
  }
  function dayPanel(ds) {
    const list = derive().byDate[ds] || [];
    const hol = S.hol[ds];
    const tot = list.reduce((a, x) => a + x.total, 0);
    let h = '<div class="sec-h"><span>' + mdw(ds) + (hol ? ' <em class="hol">' + esc(hol) + '</em>' : '') + '</span>' + (tot ? '<span class="num">' + yen(tot) + '</span>' : '') + '</div>';
    h += '<div class="card">';
    if (!list.length) h += '<div class="empty small">シフトはありません</div>';
    list.forEach(x => { h += shiftRow(x); });
    h += '<button class="add-row" data-act="add" data-d="' + ds + '">' + ICON.plus + 'シフトを追加</button></div>';
    return h;
  }
  function shiftRow(x, showDate) {
    const badge = x.src === 'gcal' ? '<span class="tag g">カレンダー</span>' : '<span class="tag">手入力</span>';
    const st = x.hidden ? '<span class="tag warn">除外中</span>' : x.dup ? '<span class="tag warn">カレンダーと重複</span>' : '<span class="tag s-' + x.state + '">' + stateLabel[x.state] + '</span>';
    return '<button class="shift' + (x.off ? ' off' : '') + '" data-act="edit" data-id="' + esc(x.id) + '">'
      + '<i class="bar" style="background:' + x.wp.color + '"></i>'
      + '<div class="main"><div class="t1">' + (showDate ? '<span class="muted">' + mdw(x.date) + '</span> ' : '') + '<b>' + esc(x.wp.name) + '</b> <span class="num">' + tRange(x) + '</span></div>'
      + '<div class="t2">実働 ' + hours(x.p.work) + (x.p.brk ? '・休憩' + x.p.brk + '分' : '') + (x.p.night ? '・深夜' + hShort(x.p.night) : '') + (x.p.ot ? '・残業' + hShort(x.p.ot) : '') + (x.memo ? '・' + esc(x.memo) : '') + '</div>'
      + '<div class="tags">' + badge + st + '</div></div>'
      + '<div class="amt num">' + yen(x.off ? x.p.amount : x.total) + (x.tr ? '<small>交通費込</small>' : '') + '</div></button>';
  }

  /* ---------------- まとめて入力（スタンプ） ---------------- */
  function stampBar() {
    const tpl = S.stamp.list;
    let h = '<div class="stamp-bar"><div class="stamp-h"><b>まとめて入力</b><span class="muted small">シフトを選んで日付をタップ（もう一度で取り消し）</span><button class="btn sm primary" data-act="stampDone">完了</button></div><div class="chips">';
    if (!tpl.length) h += '<span class="muted small">まだ履歴がありません。先に1件入力してください</span>';
    tpl.forEach((t, i) => { const w = wpById(t.wpId); h += tplChip(t, w, 'stampTpl', i, S.stamp.i === i); });
    return h + '</div></div>';
  }
  function tplChip(t, w, act, i, on) {
    return '<button class="tpl' + (on ? ' on' : '') + '" data-act="' + act + '" data-i="' + i + '" style="--c:' + w.color + '"><i></i><b>' + esc(w.name) + '</b><span class="num">' + tShort(t.s, t.e) + '</span></button>';
  }
  function stampDay(ds) {
    const t = S.stamp.list[S.stamp.i];
    if (!t) { toast('上のシフトを選んでください'); return; }
    const sh = S.data.shifts;
    const hit = sh.findIndex(m => m.date === ds && m.wpId === t.wpId && hm2m(m.start) === t.s && ((hm2m(m.end) <= hm2m(m.start) ? hm2m(m.end) + 1440 : hm2m(m.end)) === t.e));
    if (hit >= 0) sh.splice(hit, 1);
    else sh.push({ id: uid(), date: ds, start: m2hm(t.s), end: m2hm(t.e), wpId: t.wpId, brk: t.brk, memo: '', createdAt: new Date().toISOString() });
    persist();
    S.sel = ds;
    render();
  }

  /* ---------------- シフトの入力・編集 ---------------- */
  function openShift(id, date) {
    const x = id ? derive().all.find(s => s.id === id) : null;
    if (x) {
      S.form = { id: x.id, src: x.src, date: x.date, start: m2hm(x.s), end: m2hm(x.e), wpId: x.wpId, brk: x.brk == null ? '' : String(x.brk), memo: x.memo || '', hidden: x.hidden, title: x.title, cal: x.cal };
    } else {
      const last = derive().tpl[0];
      const w = wps()[0];
      S.form = { id: null, src: 'manual', date: date || S.sel, start: last ? m2hm(last.s) : '10:00', end: last ? m2hm(last.e) : '18:00', wpId: last ? last.wpId : w && w.id, brk: '', memo: '', addCal: S.mode === 'api' && !!cfg().addToCal };
    }
    if (!wps().length) { toast('先に勤務先を登録してください'); S.tab = 'wp'; render(); return; }
    openSheet(x ? (x.src === 'gcal' ? 'カレンダーのシフト' : 'シフトを編集') : 'シフトを追加', '', shiftForm());
  }
  function shiftForm() {
    const f = S.form, g = f.src === 'gcal';
    let h = '';
    if (!g) {
      const tpl = derive().tpl;
      if (tpl.length) h += '<div class="lbl-s">よく使うシフト</div><div class="chips tpls">' + tpl.map((t, i) => tplChip(t, wpById(t.wpId), 'useTpl', i, f.wpId === t.wpId && hm2m(f.start) === t.s && (hm2m(f.end) <= hm2m(f.start) ? hm2m(f.end) + 1440 : hm2m(f.end)) === t.e)).join('') + '</div>';
    } else {
      h += '<div class="note">Googleカレンダーの予定「<b>' + esc(f.title) + '</b>」から読み込んでいます（' + esc(f.cal || '') + '）。日時を変えるときはカレンダーのほうを直してください。</div>';
    }
    h += '<div class="card form">'
      + '<div class="f-row"><span>勤務先</span><div class="seg">' + wps().map(w => '<button class="' + (f.wpId === w.id ? 'on' : '') + '" data-act="fWp" data-id="' + w.id + '" style="--c:' + w.color + '">' + esc(w.name) + '</button>').join('') + '</div></div>'
      + '<div class="f-row"><span>日付</span><input class="in" type="date" data-f="date" value="' + f.date + '"' + (g ? ' disabled' : '') + '></div>'
      + '<div class="f-row"><span>時間</span><div class="times"><input class="in" type="time" step="300" data-f="start" value="' + f.start + '"' + (g ? ' disabled' : '') + '><em>〜</em><input class="in" type="time" step="300" data-f="end" value="' + f.end + '"' + (g ? ' disabled' : '') + '></div></div>'
      + '<div class="f-row"><span>休憩</span><div class="brk"><input class="in num" type="number" inputmode="numeric" min="0" step="5" placeholder="自動" data-f="brk" value="' + esc(f.brk) + '"><em>分</em></div></div>'
      + (g ? '' : '<div class="f-row"><span>メモ</span><input class="in wide" type="text" data-f="memo" placeholder="任意" value="' + esc(f.memo) + '"></div>')
      + '</div>';
    h += '<div class="preview card pad" id="preview">' + previewHtml() + '</div>';
    if (g) {
      h += '<label class="card toggle"><span>このシフトを給料に含めない</span><input type="checkbox" data-f="hidden"' + (f.hidden ? ' checked' : '') + '></label>';
    } else if (!f.id && S.mode === 'api') {
      h += '<label class="card toggle"><span>Googleカレンダーにも登録する<small>カレンダーを正として、以後はカレンダーから読み込みます</small></span><input type="checkbox" data-f="addCal"' + (f.addCal ? ' checked' : '') + '></label>';
    }
    h += '<button class="btn primary block" data-act="saveShift">' + (f.id ? '保存' : '追加') + '</button>';
    if (f.id && !g) h += '<button class="btn danger block mt" data-act="delShift">このシフトを削除</button>';
    if (g && (f.brk !== '' || (cfg().overrides[f.id] || {}).wpId)) h += '<button class="btn gray block mt" data-act="resetOv">カレンダーの内容に戻す</button>';
    return h;
  }
  function formShift() {
    const f = S.form;
    if (!f.date || !f.start || !f.end) return null;
    const s = hm2m(f.start); let e = hm2m(f.end); if (e <= s) e += 1440;
    return { date: f.date, s, e, wpId: f.wpId, brk: f.brk === '' ? null : Number(f.brk) };
  }
  function previewHtml() {
    const x = formShift(), wp = x && wpById(x.wpId);
    if (!x || !wp) return '<span class="muted">時間を入れてください</span>';
    const p = C.pay(x, wp, S.hol);
    return '<div class="pv"><div><span class="lbl">実働</span><b class="num">' + hours(p.work) + '</b><small>' + (x.e >= 1440 ? '翌日まで・' : '') + '休憩' + p.brk + '分' + (x.brk == null ? '（自動）' : '') + '</small></div>'
      + '<div class="r"><span class="lbl">この日の給料</span><b class="num big2">' + yen(p.amount + (Number(wp.transport) || 0)) + '</b><small>時給' + yen(p.wage) + (p.extra ? '（土日祝+' + p.extra + '）' : '') + (p.night ? '・深夜' + hShort(p.night) : '') + (p.ot ? '・残業' + hShort(p.ot) : '') + (Number(wp.transport) ? '・交通費' + yen(wp.transport) : '') + '</small></div></div>';
  }
  async function saveShift(btn) {
    const f = S.form, x = formShift();
    if (!x || !f.wpId) { toast('日付と時間を入れてください'); return; }
    if (f.src === 'gcal') {
      const ov = cfg().overrides;
      const o = {};
      if (f.hidden) o.hidden = true;
      if (f.brk !== '') o.brk = Number(f.brk);
      const ev = S.data.events.find(e => e.id === f.id);
      const auto = ev && matchWp(ev.t);
      if (!auto || auto.id !== f.wpId) o.wpId = f.wpId;
      if (Object.keys(o).length) ov[f.id] = o; else delete ov[f.id];
      persist(); closeSheet(); render(); return;
    }
    const row = { id: f.id || uid(), date: f.date, start: f.start, end: f.end, wpId: f.wpId, brk: f.brk === '' ? null : Number(f.brk), memo: f.memo, createdAt: new Date().toISOString() };
    if (!f.id && f.addCal && S.mode === 'api') {
      cfg().addToCal = true;
      const wp = wpById(f.wpId);
      const s0 = toDate(f.date).getTime();
      btn.disabled = true; btn.textContent = 'カレンダーに登録中…';
      try {
        const j = await api('addEvent', { calendarId: (cfg().calendarIds || [])[0] || '', title: (wp.keywords || [])[0] || wp.name, s: s0 + x.s * 60000, e: s0 + x.e * 60000, memo: f.memo });
        S.data.events.push(j.event);
        if (row.brk != null) cfg().overrides[j.event.id] = { brk: row.brk };
        if (!matchWp(j.event.t) || matchWp(j.event.t).id !== f.wpId) cfg().overrides[j.event.id] = Object.assign(cfg().overrides[j.event.id] || {}, { wpId: f.wpId });
        persist(); closeSheet(); S.sel = f.date; render(); toast('Googleカレンダーに登録しました');
        return;
      } catch (e) {
        toast('カレンダーに登録できなかったので手入力として保存しました');
      }
    } else if (!f.id && S.mode === 'api') cfg().addToCal = false;
    const i = S.data.shifts.findIndex(m => m.id === row.id);
    if (i >= 0) S.data.shifts[i] = row; else S.data.shifts.push(row);
    persist(); closeSheet(); S.sel = f.date;
    const d = toDate(f.date); S.month = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  }

  /* ---------------- 給料 ---------------- */
  function viewPay() {
    const d = derive(), y = S.year;
    const list = d.on.filter(x => x.payDate.slice(0, 4) === String(y));
    const sm = sumOf(list);
    const goal = Number(cfg().goal) || 0, wall = Number(cfg().wall) || 0;
    const max = Math.max(sm.total, goal, wall, 1) * 1.04;
    const mark = (v, cls, label) => v ? '<i class="mk ' + cls + '" style="left:' + (v / max * 100) + '%"><span>' + label + '</span></i>' : '';
    let h = '<div class="page-h"><h1>給料</h1><div class="ynav"><button class="nav-btn" data-act="yprev">' + ICON.prev + '</button><b>' + y + '年</b><button class="nav-btn" data-act="ynext">' + ICON.next + '</button></div></div>';
    h += '<div class="card pad hero">'
      + '<div class="lbl">' + y + '年に受け取る給料（見込み）</div><div class="big num">' + yen(sm.total) + '</div>'
      + '<div class="mbar-wrap">' + moneyBar(sm, max) + mark(goal, 'goal', '目標') + mark(wall, 'wall', man(wall)) + '</div>'
      + '<div class="rows3">'
      + '<div><i class="k-recv"></i><span>受け取った</span><b class="num">' + yen(sm.recv) + '</b></div>'
      + '<div><i class="k-earned"></i><span>働いた・振込待ち</span><b class="num">' + yen(sm.earned) + '</b></div>'
      + '<div><i class="k-plan"></i><span>シフト予定</span><b class="num">' + yen(sm.plan) + '</b></div></div>';
    const notes = [];
    if (goal) notes.push(sm.total >= goal ? '<span class="ok">目標の ' + yen(goal) + ' に届く見込み 🎉</span>' : '目標 ' + yen(goal) + ' まで あと <b>' + yen(goal - sm.total) + '</b>（受け取り済みは ' + Math.floor(sm.recv / goal * 100) + '%）');
    if (wall) notes.push(sm.total > wall ? '<span class="ng">' + man(wall) + '円の壁を ' + yen(sm.total - wall) + ' 超える見込みです</span>' : man(wall) + '円の壁まで あと <b>' + yen(wall - sm.total) + '</b>');
    if (notes.length) h += '<div class="notes">' + notes.map(n => '<p>' + n + '</p>').join('') + '</div>';
    h += '<div class="kpis"><div class="kpi"><b class="num">' + hShort(sm.work) + '</b><span>働く時間</span></div><div class="kpi"><b class="num">' + sm.dayN + '<small>日</small></b><span>出勤日</span></div><div class="kpi"><b class="num">' + yen(sm.work ? (sm.total - sm.tr) / sm.work * 60 : 0) + '</b><span>平均時給</span></div></div>';
    h += '</div>';

    // 月ごと（給料日の月）
    const months = [];
    for (let i = 0; i < 12; i++) { const k = y + '-' + pad(i + 1); months.push(sumOf(list.filter(x => x.payDate.slice(0, 7) === k))); }
    const mmax = Math.max(1, ...months.map(o => o.total));
    h += '<div class="sec-h"><span>月ごとの給料（振込月）</span></div><div class="card pad"><div class="mbars">';
    months.forEach((o, i) => {
      const hp = v => (v / mmax * 100) + '%';
      h += '<button class="mb' + (S.payMonth === i ? ' on' : '') + '" data-act="pm" data-i="' + i + '"><div class="st"><i class="k-plan" style="height:' + hp(o.plan) + '"></i><i class="k-earned" style="height:' + hp(o.earned) + '"></i><i class="k-recv" style="height:' + hp(o.recv) + '"></i></div><span>' + (i + 1) + '</span></button>';
    });
    h += '</div>';
    const pm = months[S.payMonth], pk = y + '-' + pad(S.payMonth + 1);
    h += '<div class="pm-sum"><b>' + (S.payMonth + 1) + '月の振込</b><b class="num">' + yen(pm.total) + '</b></div>';
    // 給料日×勤務先ごと
    const groups = {};
    list.filter(x => x.payDate.slice(0, 7) === pk).forEach(x => { const g = x.payDate + '|' + x.wpId; (groups[g] = groups[g] || []).push(x); });
    const keys = Object.keys(groups).sort();
    if (!keys.length) h += '<div class="empty small">この月の振込はありません</div>';
    keys.forEach(k => {
      const g = groups[k], s = sumOf(g), w = g[0].wp, pd = k.split('|')[0];
      const st = pd <= ymd(new Date()) ? 'recv' : s.plan ? 'plan' : 'earned';
      const per = C.periodOf(g[0].date, w);
      h += '<button class="payrow" data-act="payDetail" data-k="' + k + '"><i class="bar" style="background:' + w.color + '"></i><div class="main"><b>' + esc(w.name) + '</b><div class="t2">' + md(pd) + ' 支給・' + md(per.start) + '〜' + md(per.end) + '分・' + s.n + '回 ' + hShort(s.work) + '</div></div><div class="r"><b class="num">' + yen(s.total) + '</b><span class="tag s-' + st + '">' + (st === 'recv' ? '受取済' : st === 'plan' ? '予定あり' : '振込待ち') + '</span></div></button>';
    });
    h += '</div>';
    h += '<p class="hint">「受け取った」は給料日を過ぎた分、「振込待ち」は働き終わって給料日前の分、「シフト予定」はこれからのシフトです。年の区切りは振込日（扶養の判定と同じ）。税金・社会保険は引く前の金額です。</p>';
    return h;
  }
  function payDetail(k) {
    const [pd, wpId] = k.split('|');
    const list = derive().on.filter(x => x.payDate === pd && x.wpId === wpId);
    const s = sumOf(list), w = wpById(wpId);
    let h = '<div class="card pad"><div class="pv"><div><span class="lbl">実働</span><b class="num">' + hours(s.work) + '</b><small>' + s.n + '回' + (s.night ? '・深夜' + hShort(s.night) : '') + '</small></div><div class="r"><span class="lbl">支給額（見込み）</span><b class="num big2">' + yen(s.total) + '</b><small>' + (s.tr ? '交通費 ' + yen(s.tr) + ' 込み' : '') + '</small></div></div></div>';
    h += '<div class="card mt">' + list.map(x => shiftRow(x, true)).join('') + '</div>';
    openSheet(esc(w.name) + ' ' + md(pd) + ' 支給', '', h);
  }

  /* ---------------- 勤務先 ---------------- */
  function viewWp() {
    const d = derive(), y = new Date().getFullYear();
    let h = '<div class="page-h"><h1>勤務先</h1><button class="btn sm soft" data-act="newWp">' + ICON.plus + '追加</button></div>';
    if (!wps().length) h += '<div class="card welcome"><div class="emoji">🏪</div><h2>勤務先を登録しよう</h2><p>時給と、Googleカレンダーの予定名に入っている<b>キーワード</b>（例: 「カフェ」「塾」）を登録すると、カレンダーのシフトを自動で給料に計算します。</p><button class="btn primary block" data-act="newWp">勤務先を追加</button></div>';
    wps().forEach(w => {
      const s = sumOf(d.on.filter(x => x.wpId === w.id && x.payDate.slice(0, 4) === String(y)));
      h += '<button class="card wpc" data-act="editWp" data-id="' + w.id + '"><div class="top"><i style="background:' + w.color + '"></i><b>' + esc(w.name) + '</b><span class="num wage">時給 ' + yen(C.wageAt(w, ymd(new Date()))) + '</span></div>'
        + '<div class="kw">' + ((w.keywords || []).length ? (w.keywords || []).map(k => '<span class="tag g">' + esc(k) + '</span>').join('') : '<span class="tag warn">キーワード未設定（カレンダーから読み込みません）</span>') + '</div>'
        + '<div class="meta"><span>' + closeLabel(w) + '</span><span>' + y + '年 <b class="num">' + yen(s.total) + '</b></span></div></button>';
    });
    return h;
  }
  const offL = ['当月', '翌月', '翌々月'];
  const closeLabel = w => (Number(w.closeDay) ? w.closeDay + '日締め' : '末日締め') + '・' + offL[Number(w.payOffset == null ? 1 : w.payOffset)] + (Number(w.payDay) ? w.payDay + '日' : '末日') + '払い';
  function openWp(id) {
    const w = id ? wpById(id) : null;
    const today = ymd(new Date());
    S.wpForm = w ? JSON.parse(JSON.stringify(w)) : { id: null, name: '', color: COLORS[wps().length % COLORS.length], keywords: [], wages: [{ from: '2000-01-01', wage: '' }], closeDay: 0, payOffset: 1, payDay: 25, breakMode: 'auto', breakMin: 60, night: true, overtime: true, holidayExtra: 0, transport: 0 };
    S.wpForm.kwText = (S.wpForm.keywords || []).join('、');
    if (!S.wpForm.wages.length) S.wpForm.wages = [{ from: '2000-01-01', wage: '' }];
    S.wpForm.today = today;
    openSheet(w ? '勤務先を編集' : '勤務先を追加', '', wpFormHtml());
  }
  function wpFormHtml() {
    const f = S.wpForm;
    const opt = (arr, v) => arr.map(o => '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    const days = [[0, '末日']]; for (let i = 1; i <= 28; i++) days.push([i, i + '日']);
    const pdays = [[0, '末日']]; for (let i = 1; i <= 31; i++) pdays.push([i, i + '日']);
    const wages = f.wages.slice().map((x, i) => ({ x, i })).sort((a, b) => a.x.from < b.x.from ? -1 : 1);
    let h = '<div class="card form">'
      + '<div class="f-row"><span>名前</span><input class="in wide" data-w="name" placeholder="例: カフェ" value="' + esc(f.name) + '"></div>'
      + '<div class="f-row"><span>色</span><div class="colors">' + COLORS.map(c => '<button class="' + (f.color === c ? 'on' : '') + '" data-act="wColor" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') + '</div></div>'
      + '</div>';
    h += '<div class="lbl-s">時給</div><div class="card form">';
    wages.forEach((o, k) => {
      h += '<div class="f-row"><span>' + (k === 0 ? 'はじめ' : '<input class="in dt" type="date" data-wg="from" data-i="' + o.i + '" value="' + o.x.from + '">から') + '</span><div class="brk"><input class="in num" type="number" inputmode="numeric" data-wg="wage" data-i="' + o.i + '" placeholder="1100" value="' + esc(o.x.wage) + '"><em>円</em>' + (k ? '<button class="x" data-act="wDelWage" data-i="' + o.i + '" aria-label="削除">×</button>' : '') + '</div></div>';
    });
    h += '<button class="add-row" data-act="wAddWage">' + ICON.plus + '時給が変わる日を追加</button></div>';
    h += '<div class="lbl-s">Googleカレンダー</div><div class="card form"><div class="f-row col"><span>予定名のキーワード</span><input class="in wide" data-w="kwText" placeholder="例: カフェ、スタバ" value="' + esc(f.kwText) + '"><small>予定のタイトルにこの言葉が入っていると、この勤務先のシフトとして読み込みます。「、」区切りで複数OK。</small></div></div>';
    h += '<div class="lbl-s">給料日</div><div class="card form">'
      + '<div class="f-row"><span>締め日</span><select class="in" data-w="closeDay">' + opt(days, f.closeDay) + '</select></div>'
      + '<div class="f-row"><span>支払日</span><div class="times"><select class="in" data-w="payOffset">' + opt([[0, '当月'], [1, '翌月'], [2, '翌々月']], f.payOffset) + '</select><select class="in" data-w="payDay">' + opt(pdays, f.payDay) + '</select></div></div></div>';
    h += '<div class="lbl-s">手当・休憩</div><div class="card form">'
      + '<div class="f-row"><span>休憩</span><div class="times"><select class="in" data-w="breakMode">' + opt([['auto', '自動（6h超45分・8h超60分）'], ['fixed', '毎回決まった時間'], ['none', 'なし']], f.breakMode) + '</select>' + (f.breakMode === 'fixed' ? '<input class="in num sm" type="number" inputmode="numeric" data-w="breakMin" value="' + esc(f.breakMin) + '"><em>分</em>' : '') + '</div></div>'
      + '<label class="f-row"><span>深夜手当（22〜5時 ×1.25）</span><input type="checkbox" data-w="night"' + (f.night !== false ? ' checked' : '') + '></label>'
      + '<label class="f-row"><span>残業手当（1日8時間超 ×1.25）</span><input type="checkbox" data-w="overtime"' + (f.overtime !== false ? ' checked' : '') + '></label>'
      + '<div class="f-row"><span>土日祝の時給アップ</span><div class="brk"><em>+</em><input class="in num" type="number" inputmode="numeric" data-w="holidayExtra" value="' + esc(f.holidayExtra || 0) + '"><em>円</em></div></div>'
      + '<div class="f-row"><span>交通費（1日）</span><div class="brk"><input class="in num" type="number" inputmode="numeric" data-w="transport" value="' + esc(f.transport || 0) + '"><em>円</em></div></div>'
      + '</div>';
    h += '<button class="btn primary block mt" data-act="saveWp">保存</button>';
    if (f.id) h += '<button class="btn danger block mt" data-act="delWp">この勤務先を削除</button>';
    return h;
  }
  function saveWp() {
    const f = S.wpForm;
    if (!f.name.trim()) { toast('名前を入れてください'); return; }
    const wages = f.wages.filter(x => x.wage !== '' && x.from).map(x => ({ from: x.from, wage: Number(x.wage) }));
    if (!wages.length) { toast('時給を入れてください'); return; }
    const w = {
      id: f.id || 'w' + uid(), name: f.name.trim(), color: f.color,
      keywords: String(f.kwText || '').split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean),
      wages, closeDay: Number(f.closeDay), payOffset: Number(f.payOffset), payDay: Number(f.payDay),
      breakMode: f.breakMode, breakMin: Number(f.breakMin) || 0, night: !!f.night, overtime: !!f.overtime,
      holidayExtra: Number(f.holidayExtra) || 0, transport: Number(f.transport) || 0,
    };
    const list = cfg().workplaces = wps().slice();
    const i = list.findIndex(x => x.id === w.id);
    const kwChanged = i < 0 || JSON.stringify(list[i].keywords) !== JSON.stringify(w.keywords);
    if (i >= 0) list[i] = w; else list.push(w);
    persist(); closeSheet(); render();
    if (kwChanged && S.mode === 'api') setTimeout(() => sync(), 800);
  }

  /* ---------------- 設定 ---------------- */
  function viewSet() {
    const c = cfg();
    let h = '<div class="page-h"><h1>設定</h1></div>';
    h += '<div class="sec-h"><span>Googleカレンダー連携</span></div><div class="card">';
    if (S.mode === 'api') {
      h += '<div class="set-row"><div class="l"><span class="status-dot on"></span>つながっています<small>' + (S.lastSync ? '最終同期 ' + new Date(S.lastSync).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'まだ同期していません') + '</small></div><button class="btn sm soft" data-act="sync">今すぐ同期</button></div>'
        + '<div class="set-row"><div class="l">読み込むカレンダー<small>' + (c.calendarIds && c.calendarIds.length ? c.calendarIds.length + '個を選択中' : 'メインのカレンダー') + '</small></div><button class="btn sm gray" data-act="pickCal">選ぶ</button></div>'
        + '<div class="set-row"><div class="l">連携を解除<small>この端末のURLだけ消します</small></div><button class="btn sm danger" data-act="unlink">解除</button></div>';
    } else {
      h += '<div class="guide"><b>つなぎ方</b>（最初の1回だけ・5分ほど）<ol>'
        + '<li>Googleドライブで新しいスプレッドシートを作り、名前を <code>シフトログデータ</code> にする</li>'
        + '<li>メニューの 拡張機能 → Apps Script を開き、中身を消して <a class="link" href="https://github.com/maomax0427/shiftlog/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">Code.gs</a> を貼り付けて保存</li>'
        + '<li>上の関数の選択を <code>setup</code> にして ▶実行 → 権限を「許可」（カレンダーとスプレッドシート）</li>'
        + '<li>デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行するユーザー「自分」、アクセス「全員」→ デプロイ</li>'
        + '<li>出てきた ウェブアプリの URL を下に貼る</li></ol></div>'
        + '<div class="pad-x"><input class="field" id="apiUrl" placeholder="https://script.google.com/macros/s/…/exec"><button class="btn primary block mt" data-act="link">つなぐ</button></div>'
        + '<p class="hint pad-x">つなぐと、この端末で入れた勤務先・手入力のシフトはスプレッドシートに引き継がれます。</p>';
    }
    h += '</div>';
    h += '<div class="sec-h"><span>目標</span></div><div class="card">'
      + '<div class="set-row"><div class="l">年間の目標額<small>給料タブで「あといくら」を表示</small></div><div class="brk"><input class="num-in" type="number" inputmode="numeric" data-c="goal" placeholder="0" value="' + (c.goal ? Math.round(c.goal / 10000) : '') + '"><em>万円</em></div></div>'
      + '<div class="set-row"><div class="l">扶養の壁<small>年収（振込ベース）がこれを超えそうなら知らせる</small></div><select class="sel" data-c="wall">' + WALLS.map(o => '<option value="' + o[0] + '"' + (Number(c.wall) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>'
      + '</div>';
    h += '<div class="sec-h"><span>表示</span></div><div class="card"><div class="set-row"><div class="l">週のはじまり</div><div class="seg sm"><button class="' + (!Number(c.weekStart) ? 'on' : '') + '" data-act="ws" data-v="0">日曜</button><button class="' + (Number(c.weekStart) === 1 ? 'on' : '') + '" data-act="ws" data-v="1">月曜</button></div></div></div>';
    h += '<div class="sec-h"><span>データ</span></div><div class="card">'
      + '<div class="set-row"><div class="l">バックアップを書き出す<small>勤務先・手入力のシフト（JSON）</small></div><button class="btn sm gray" data-act="export">書き出す</button></div>'
      + '<div class="set-row"><div class="l">バックアップから戻す</div><label class="btn sm gray">読み込む<input type="file" accept="application/json" id="importFile" hidden></label></div>'
      + (S.mode === 'demo' ? '<div class="set-row"><div class="l">お試しデータを終える<small>空の状態から自分で使いはじめる</small></div><button class="btn sm soft" data-act="startLocal">はじめる</button></div>'
        : S.mode === 'local' ? '<div class="set-row"><div class="l">お試しデータを見る</div><button class="btn sm gray" data-act="demo">表示</button></div>' : '')
      + '</div>';
    h += '<p class="hint">給料は税金・社会保険を引く前の額（額面）です。深夜は22〜5時、残業は1日8時間を超えた分を25%増しで計算します。祝日は内閣府の祝日データを使います。</p>';
    return h;
  }
  async function pickCal() {
    openSheet('読み込むカレンダー', '', '<div class="empty">読み込み中…</div>');
    try {
      const j = await api('calendars');
      S.cals = j.calendars;
      renderCalPick();
    } catch (e) { $('#sheet .sh-b').innerHTML = '<div class="empty">取得できませんでした: ' + esc(e.message) + '</div>'; }
  }
  function renderCalPick() {
    const ids = cfg().calendarIds || [];
    let h = '<p class="hint">シフトを入れているカレンダーを選んでください。何も選ばないとメインのカレンダーを読みます。アプリから登録するシフトは、選んだうち一番上のカレンダーに入ります。</p><div class="card mt">';
    S.cals.forEach(c => { h += '<label class="set-row"><div class="l"><span class="status-dot" style="background:' + esc(c.color) + '"></span>' + esc(c.name) + (c.primary ? '<small>メイン</small>' : '') + '</div><input type="checkbox" data-cal="' + esc(c.id) + '"' + (ids.indexOf(c.id) >= 0 ? ' checked' : '') + '></label>'; });
    h += '</div><button class="btn primary block mt" data-act="saveCals">保存して同期</button>';
    $('#sheet .sh-b').innerHTML = h;
  }

  function viewWelcome() {
    return '<div class="card welcome big-w"><div class="emoji">🗓️💴</div><h2>シフトログ</h2>'
      + '<p>Googleカレンダーのバイトの予定を読み込んで、時給から給料を自動で計算。<br>いくら<b>貯まった</b>か、いくら<b>貯まる予定</b>かがひと目でわかります。</p>'
      + '<button class="btn primary block" data-act="gotoLink">Googleカレンダーとつなぐ</button>'
      + '<button class="btn soft block" data-act="demo">お試しデータで見てみる</button>'
      + '<button class="btn gray block" data-act="startLocal">手入力だけではじめる</button></div>';
  }

  /* ---------------- 描画 ---------------- */
  function render() {
    const main = $('#main');
    if (!S.mode) { main.innerHTML = viewWelcome(); $('#tabbar').hidden = true; $('#fab').hidden = true; $('#stamp').hidden = true; return; }
    $('#tabbar').hidden = false;
    const y = window.scrollY;
    main.innerHTML = S.tab === 'pay' ? viewPay() : S.tab === 'wp' ? viewWp() : S.tab === 'set' ? viewSet() : viewCal();
    window.scrollTo(0, y);
    $('#tabbar').innerHTML = TABS.map(t => '<button class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + ICON[t[0]] + '<span>' + t[1] + '</span></button>').join('');
    const onCal = S.tab === 'cal';
    $('#fab').hidden = !onCal || !!S.stamp;
    $('#fab').innerHTML = '<button class="fab-s" data-act="stamp" aria-label="まとめて入力">' + ICON.stamp + '</button><button class="fab-m" data-act="add" aria-label="シフトを追加">' + ICON.plus + '</button>';
    const sb = $('#stamp');
    sb.hidden = !(onCal && S.stamp);
    if (onCal && S.stamp) sb.innerHTML = stampBar();
    document.body.classList.toggle('with-stamp', !!(onCal && S.stamp));
  }
  function openSheet(title, sub, body) {
    const sh = $('#sheet');
    sh.innerHTML = '<div class="sh-h"><div><h3>' + title + '</h3>' + (sub ? '<div class="dt">' + sub + '</div>' : '') + '</div><button class="close-x" data-act="close" aria-label="閉じる">×</button></div><div class="sh-b">' + body + '</div>';
    sh.hidden = false; $('#sheetBack').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet').hidden = true; $('#sheetBack').hidden = true; document.body.style.overflow = '';
    S.form = null; S.wpForm = null;
  }
  const rerenderSheet = html => { const b = $('#sheet .sh-b'); const t = b.scrollTop; b.innerHTML = html; b.scrollTop = t; };

  /* ---------------- 操作 ---------------- */
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; store.set(K.tab, S.tab); S.stamp = null; render(); window.scrollTo(0, 0); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    const shiftM = n => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); render(); };
    switch (a) {
      case 'mprev': shiftM(-1); break;
      case 'mnext': shiftM(1); break;
      case 'mtoday': { const t = new Date(); S.month = new Date(t.getFullYear(), t.getMonth(), 1); S.sel = ymd(t); render(); break; }
      case 'day': {
        const ds = b.dataset.d;
        if (S.stamp) { stampDay(ds); break; }
        if (S.sel === ds && !(derive().byDate[ds] || []).length) { openShift(null, ds); break; }
        S.sel = ds;
        const t = toDate(ds);
        if (t.getMonth() !== S.month.getMonth()) S.month = new Date(t.getFullYear(), t.getMonth(), 1);
        render(); break;
      }
      case 'add': openShift(null, b.dataset.d || S.sel); break;
      case 'edit': openShift(b.dataset.id); break;
      case 'stamp': if (!wps().length) { toast('先に勤務先を登録してください'); break; } S.stamp = { i: 0, list: derive().tpl.slice() }; render(); break;
      case 'stampTpl': S.stamp.i = Number(b.dataset.i); render(); break;
      case 'stampDone': S.stamp = null; render(); break;
      case 'useTpl': { const t = derive().tpl[Number(b.dataset.i)]; Object.assign(S.form, { wpId: t.wpId, start: m2hm(t.s), end: m2hm(t.e), brk: t.brk == null ? '' : String(t.brk) }); rerenderSheet(shiftForm()); break; }
      case 'fWp': S.form.wpId = b.dataset.id; rerenderSheet(shiftForm()); break;
      case 'saveShift': saveShift(b); break;
      case 'delShift': if (confirm('このシフトを削除しますか？')) { S.data.shifts = S.data.shifts.filter(m => m.id !== S.form.id); persist(); closeSheet(); render(); } break;
      case 'resetOv': delete cfg().overrides[S.form.id]; persist(); closeSheet(); render(); break;
      case 'sync': sync(); break;
      case 'yprev': S.year--; render(); break;
      case 'ynext': S.year++; render(); break;
      case 'pm': S.payMonth = Number(b.dataset.i); render(); break;
      case 'payDetail': payDetail(b.dataset.k); break;
      case 'newWp': S.tab = 'wp'; store.set(K.tab, 'wp'); render(); openWp(null); break;
      case 'editWp': openWp(b.dataset.id); break;
      case 'wColor': S.wpForm.color = b.dataset.c; rerenderSheet(wpFormHtml()); break;
      case 'wAddWage': S.wpForm.wages.push({ from: S.wpForm.today, wage: '' }); rerenderSheet(wpFormHtml()); break;
      case 'wDelWage': S.wpForm.wages.splice(Number(b.dataset.i), 1); rerenderSheet(wpFormHtml()); break;
      case 'saveWp': saveWp(); break;
      case 'delWp': {
        const n = derive().all.filter(x => x.wpId === S.wpForm.id).length;
        if (!confirm('「' + S.wpForm.name + '」を削除しますか？' + (n ? '\nこの勤務先のシフト ' + n + ' 件は給料に数えなくなります。' : ''))) break;
        cfg().workplaces = wps().filter(w => w.id !== S.wpForm.id);
        S.data.shifts = S.data.shifts.filter(m => m.wpId !== S.wpForm.id);
        persist(); closeSheet(); render(); break;
      }
      case 'ws': cfg().weekStart = Number(b.dataset.v); persist(); render(); break;
      case 'gotoSet': S.tab = 'set'; store.set(K.tab, 'set'); render(); window.scrollTo(0, 0); break;
      case 'gotoLink': S.mode = 'local'; store.set(K.mode, 'local'); loadLocal(); S.tab = 'set'; render(); setTimeout(() => { const i = $('#apiUrl'); if (i) i.focus(); }, 50); break;
      case 'demo': S.mode = 'demo'; store.set(K.mode, 'demo'); store.del('shiftlog:data:demo'); loadLocal(); S.tab = 'cal'; render(); break;
      case 'startLocal': S.mode = 'local'; store.set(K.mode, 'local'); loadLocal(); S.tab = wps().length ? 'cal' : 'wp'; render(); break;
      case 'link': link(); break;
      case 'unlink': if (confirm('この端末の連携を解除しますか？（スプレッドシートのデータは残ります）')) { S.api = ''; store.del(K.api); S.mode = 'local'; store.set(K.mode, 'local'); loadLocal(); render(); } break;
      case 'pickCal': pickCal(); break;
      case 'saveCals': {
        cfg().calendarIds = S.cals.map(c => c.id).filter(id => { const i = document.querySelector('[data-cal="' + CSS.escape(id) + '"]'); return i && i.checked; });
        persist(); closeSheet(); render(); setTimeout(() => sync(), 800); break;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify({ app: 'shiftlog', config: cfg(), shifts: S.data.shifts }, null, 2)], { type: 'application/json' });
        const u = URL.createObjectURL(blob), l = document.createElement('a');
        l.href = u; l.download = 'shiftlog-' + ymd(new Date()) + '.json'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); break;
      }
      case 'close': closeSheet(); break;
    }
  });
  $('#sheetBack').addEventListener('click', closeSheet);

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f && S.form) {
      S.form[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
      const p = $('#preview'); if (p) p.innerHTML = previewHtml();
    } else if (t.dataset.w && S.wpForm) {
      S.wpForm[t.dataset.w] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.w === 'breakMode') rerenderSheet(wpFormHtml());
    } else if (t.dataset.wg && S.wpForm) {
      S.wpForm.wages[Number(t.dataset.i)][t.dataset.wg] = t.value;
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.c) {
      cfg()[t.dataset.c] = t.dataset.c === 'goal' ? (Number(t.value) || 0) * 10000 : Number(t.value) || 0;
      persist(); render();
    } else if (t.id === 'importFile' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const j = JSON.parse(r.result);
          if (!j.config || !Array.isArray(j.shifts)) throw new Error('形式が違います');
          if (!confirm('今の勤務先と手入力のシフトを、バックアップの内容で置き換えますか？')) return;
          S.data.config = Object.assign({}, DEF_CFG, j.config); S.data.shifts = j.shifts;
          persist(); render(); toast('読み込みました');
          if (S.mode === 'api') setTimeout(() => sync(true), 900);
        } catch (err) { toast('読み込めませんでした: ' + err.message); }
      };
      r.readAsText(t.files[0]);
    }
  });

  async function link() {
    const url = ($('#apiUrl').value || '').trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('Apps Script のウェブアプリの URL を貼ってください'); return; }
    S.api = url;
    try {
      const j = await api('load', Object.assign({ keywords: keywords() }, range()));
      // スプレッドシートに設定がなければ、この端末の内容を引き継ぐ
      const local = S.mode === 'local' ? S.data : null;
      store.set(K.api, url); S.mode = 'api'; store.set(K.mode, 'api');
      if (j.config && (j.config.workplaces || []).length) {
        S.data = { config: Object.assign({}, DEF_CFG, j.config), shifts: j.shifts || [], events: [] };
      } else {
        S.data = { config: local ? local.config : Object.assign({}, DEF_CFG), shifts: local ? local.shifts : [], events: [] };
        S.dirty = true;
      }
      saveLocal(); D = null;
      toast('つながりました');
      S.tab = wps().length ? 'cal' : 'wp'; store.set(K.tab, S.tab);
      render();
      sync(true);
    } catch (e) {
      S.api = '';
      toast('つながりませんでした: ' + e.message);
    }
  }

  // カレンダーを左右にスワイプして月移動
  let sx = null, sy = null;
  document.addEventListener('touchstart', e => { if (e.target.closest('#calGrid')) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + (dx < 0 ? 1 : -1), 1); render(); }
  }, { passive: true });

  // アプリに戻ってきたら同期（カレンダーの変更を拾う）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.mode === 'api' && Date.now() - (S.lastSync || 0) > 5 * 60000) sync(true);
  });

  loadLocal();
  loadHolidays();
  render();
  if (S.mode === 'api') sync(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
