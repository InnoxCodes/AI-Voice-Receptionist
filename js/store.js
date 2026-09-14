const BUSINESS = { open: 8, close: 17 };

const Store = (() => {
  const KEY = 'ellie-demo-v1';
  const listeners = new Set();
  let state;

  const rid = (prefix, n = 14) => prefix + Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
  const meetLink = () => {
    const s = (n) => Array.from({ length: n }, () => 'abcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 25)]).join('');
    return `https://meet.google.com/${s(3)}-${s(4)}-${s(3)}`;
  };

  const SEED_TEMPLATES = [
    [[9, 0, 60, 'AC tune-up — Garcia residence'], [14, 30, 90, 'Heat pump install — Patel'], [11, 0, 60, 'Duct inspection — Nguyen']],
    [[8, 0, 90, 'Furnace repair — Thompson'], [12, 0, 60, 'Crew lunch / truck restock'], [15, 0, 60, 'Thermostat upgrade — Brooks']],
    [[10, 0, 120, 'Commercial RTU service — HEB #412'], [13, 30, 60, 'Free estimate — Ramirez']],
    [[9, 30, 60, 'Mini-split install — Walker'], [11, 0, 30, 'Warranty call — Kim'], [14, 0, 120, 'New construction walkthrough']],
    [[8, 30, 60, 'Refrigerant recharge — Davis'], [13, 0, 90, 'Water heater swap — Chen'], [16, 0, 60, 'Team huddle']],
  ];

  function seedEvents(now) {
    const events = [];
    let day = Time.dayStart(now);
    let i = 0;
    const firstBiz = Time.nextBusinessDay(now);
    for (let n = 0; n < 12 && i < 8; n++, day = Time.addDays(day, 1)) {
      if (Time.isWeekend(day)) continue;
      const tpl = Time.sameDay(day, firstBiz) ? SEED_TEMPLATES[0] : SEED_TEMPLATES[(i % 4) + 1];
      for (const [h, m, dur, summary] of tpl) {
        const start = Time.at(day, h, m);
        events.push({ id: rid('evt_', 20), summary, description: 'Existing booking', start, end: start + dur * MIN, attendees: [], hangoutLink: '', status: 'confirmed', source: 'seed' });
      }
      i++;
    }
    return events;
  }

  function fresh(now = Date.now()) {
    return {
      seededFor: Time.dateKey(now),
      callerNumber: '+1210555' + String(Math.floor(1000 + Math.random() * 9000)),
      events: seedEvents(now),
      appointments: [],
      calls: [],
      executions: 0,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch { state = null; }
    const now = Date.now();
    if (!state || !Array.isArray(state.events)) state = fresh(now);
    if (state.seededFor !== Time.dateKey(now)) {
      state.events = state.events.filter((e) => e.source !== 'seed').concat(seedEvents(now));
      state.seededFor = Time.dateKey(now);
    }
    save();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    listeners.forEach((fn) => fn(state));
  }

  function reset() {
    const num = state?.callerNumber;
    state = fresh();
    if (num) state.callerNumber = num;
    save();
  }

  return {
    load, save, reset, rid, meetLink,
    get: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

function fmtPhone(n) {
  const d = String(n).replace(/\D/g, '').slice(-10);
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
