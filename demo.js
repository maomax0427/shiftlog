// シフトログ — お試し用のサンプルデータ
window.DEMO = {
  make() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const config = {
      workplaces: [
        { id: 'w1', name: 'カフェ', color: '#139DA6', keywords: ['カフェ'], wages: [{ from: '2025-01-01', wage: 1150 }, { from: today.getFullYear() + '-10-01', wage: 1200 }],
          closeDay: 0, payOffset: 1, payDay: 25, breakMode: 'auto', night: true, overtime: true, holidayExtra: 50, transport: 400 },
        { id: 'w2', name: '塾講師', color: '#8E5BD9', keywords: ['塾'], wages: [{ from: '2025-01-01', wage: 1600 }],
          closeDay: 15, payOffset: 0, payDay: 25, breakMode: 'none', night: true, overtime: true, holidayExtra: 0, transport: 0 },
      ],
      goal: 1000000, wall: 1230000, weekStart: 0, calendarIds: [], overrides: {},
    };
    const events = [];
    const start = new Date(today.getFullYear() - 1, 9, 1);
    const end = new Date(today.getTime() + 24 * 864e5);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const w = d.getDay();
      const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      if ((w === 1 || w === 3) && rnd() < 0.85) events.push({ t: 'カフェ', s: at(10, 0), e: at(15, 0) });
      if (w === 6 && rnd() < 0.8) events.push({ t: 'カフェ', s: at(9, 0), e: at(18, 0) });
      if (w === 5 && rnd() < 0.35) events.push({ t: 'カフェ 締め', s: at(17, 0), e: at(23, 0) });
      if ((w === 2 || w === 4) && rnd() < 0.9) events.push({ t: '塾', s: at(17, 0), e: at(21, 30) });
    }
    events.forEach((e, i) => { e.id = 'demo' + i + '@' + e.s; e.cal = 'マイカレンダー'; });
    const p = n => String(n).padStart(2, '0');
    const d1 = new Date(today.getTime() - 9 * 864e5), d2 = new Date(today.getTime() + 5 * 864e5);
    const ds = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    const shifts = [
      { id: 'm1', date: ds(d1), start: '18:00', end: '22:00', wpId: 'w1', brk: null, memo: 'ヘルプ', createdAt: '' },
      { id: 'm2', date: ds(d2), start: '13:00', end: '17:00', wpId: 'w2', brk: 0, memo: '模試監督', createdAt: '' },
    ];
    return { config, events, shifts };
  },
};
