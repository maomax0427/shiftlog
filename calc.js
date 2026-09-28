// シフトログ — 給料の計算
window.C = (function () {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const toDate = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const hm2m = s => { const a = String(s).split(':').map(Number); return a[0] * 60 + (a[1] || 0); };
  const m2hm = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  const dim = (y, m) => new Date(y, m + 1, 0).getDate();   // m は 0 始まり
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const man = n => { const v = n / 10000; return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ja-JP') + '万'; };
  const hours = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return mm ? h + '時間' + mm + '分' : h + '時間'; };
  const hShort = m => (Math.round(m / 6) / 10).toLocaleString('ja-JP') + 'h';

  const NIGHT = [[-120, 300], [1320, 1740], [2760, 3180]];   // 22時〜翌5時（前日分・当日分・翌日分）

  // 勤務先の時給（変更履歴から、その日に有効なもの）
  function wageAt(wp, date) {
    const ws = (wp.wages || []).slice().sort((a, b) => a.from < b.from ? -1 : 1);
    let w = ws.length ? ws[0].wage : 0;
    ws.forEach(x => { if (x.from <= date) w = x.wage; });
    return Number(w) || 0;
  }
  // 休憩（入力がなければ勤務先のルール。自動＝労基法どおり 6時間超45分・8時間超60分）
  function breakOf(shift, wp) {
    if (shift.brk != null && shift.brk !== '') return Number(shift.brk) || 0;
    const dur = shift.e - shift.s;
    const mode = wp ? wp.breakMode || 'auto' : 'auto';
    if (mode === 'none') return 0;
    if (mode === 'fixed') return Math.min(dur, Number(wp.breakMin) || 0);
    return dur > 480 ? 60 : dur > 360 ? 45 : 0;
  }
  function isOff(date, holidays) {
    const w = toDate(date).getDay();
    return w === 0 || w === 6 || !!(holidays && holidays[date]);
  }

  // 1シフトの給料（交通費は日ごとに別で数える）
  function pay(shift, wp, holidays) {
    const dur = Math.max(0, shift.e - shift.s);
    const brk = Math.min(dur, breakOf(shift, wp));
    let night = 0;
    NIGHT.forEach(n => { night += Math.max(0, Math.min(shift.e, n[1]) - Math.max(shift.s, n[0])); });
    const day = dur - night;
    // 休憩はなるべく昼の時間から引く
    const nightW = Math.max(0, night - Math.max(0, brk - day));
    const work = dur - brk;
    const ot = wp && wp.overtime !== false ? Math.max(0, work - 480) : 0;
    let wage = wp ? wageAt(wp, shift.date) : 0;
    const extra = wp && Number(wp.holidayExtra) && isOff(shift.date, holidays) ? Number(wp.holidayExtra) : 0;
    wage += extra;
    const nightOn = !wp || wp.night !== false;
    const amount = Math.floor(wage * work / 60 + (nightOn ? wage * 0.25 * nightW / 60 : 0) + wage * 0.25 * ot / 60);
    return { dur, brk, work, night: nightOn ? nightW : 0, ot, wage, extra, amount };
  }

  // 給料日（締め日と支払月・日から）
  function payDate(date, wp) {
    const d = toDate(date);
    let y = d.getFullYear(), m = d.getMonth();
    const close = Number(wp && wp.closeDay) || 0;   // 0 = 末日
    if (close && close < dim(y, m) && d.getDate() > close) { m++; if (m > 11) { m = 0; y++; } }
    const off = wp && wp.payOffset != null ? Number(wp.payOffset) : 1;
    m += off; while (m > 11) { m -= 12; y++; }
    const pd = Number(wp && wp.payDay) || 0;       // 0 = 末日
    return ymd(new Date(y, m, pd ? Math.min(pd, dim(y, m)) : dim(y, m)));
  }
  // 締め期間（給料日から逆算して表示用に）
  function periodOf(date, wp) {
    const d = toDate(date);
    const close = Number(wp && wp.closeDay) || 0;
    let y = d.getFullYear(), m = d.getMonth();
    if (close && close < dim(y, m) && d.getDate() > close) { m++; if (m > 11) { m = 0; y++; } }
    const endD = close ? Math.min(close, dim(y, m)) : dim(y, m);
    const end = new Date(y, m, endD);
    let start;
    if (close) { const pm = new Date(y, m - 1, 1); start = new Date(pm.getFullYear(), pm.getMonth(), Math.min(close, dim(pm.getFullYear(), pm.getMonth())) + 1); }
    else start = new Date(y, m, 1);
    return { start: ymd(start), end: ymd(end) };
  }

  // よく使うシフト（テンプレート）: 勤務先・開始・終了・休憩の組み合わせを回数順に
  function templates(shifts, limit) {
    const map = {};
    shifts.forEach(s => {
      if (!s.wpId) return;
      const k = s.wpId + '|' + s.s + '|' + s.e + '|' + (s.brk == null ? '' : s.brk);
      const t = map[k] || (map[k] = { wpId: s.wpId, s: s.s, e: s.e, brk: s.brk == null ? null : s.brk, n: 0, last: '' });
      t.n++; if (s.date > t.last) t.last = s.date;
    });
    return Object.values(map).sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1)).slice(0, limit || 8);
  }

  return { pad, ymd, toDate, hm2m, m2hm, dim, yen, man, hours, hShort, wageAt, breakOf, isOff, pay, payDate, periodOf, templates };
})();
