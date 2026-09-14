const TZ = 'America/Chicago';
const MIN = 60000;
const SLOT = 30 * MIN;

const Time = (() => {
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parts(ms) {
    const o = {};
    for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: WD.indexOf(o.weekday) };
  }

  function offsetMin(ms) {
    const p = parts(ms);
    return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / MIN) * MIN) / MIN;
  }

  // Chicago wall-clock → epoch ms
  function make(y, m, d, h = 0, min = 0) {
    const guess = Date.UTC(y, m - 1, d, h, min);
    const off = offsetMin(guess);
    let t = guess - off * MIN;
    const off2 = offsetMin(t);
    if (off2 !== off) t = guess - off2 * MIN;
    return t;
  }

  function addDays(ms, n) {
    const p = parts(ms);
    const u = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return make(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), p.h, p.min);
  }

  function dayStart(ms) { const p = parts(ms); return make(p.y, p.m, p.d); }
  function at(ms, h, min = 0) { const p = parts(ms); return make(p.y, p.m, p.d, h, min); }
  function sameDay(a, b) { const x = parts(a), y = parts(b); return x.y === y.y && x.m === y.m && x.d === y.d; }
  function isWeekend(ms) { const wd = parts(ms).wd; return wd === 0 || wd === 6; }

  const pad = (n) => String(n).padStart(2, '0');
  function iso(ms) {
    const p = parts(ms);
    const off = offsetMin(ms);
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  function dateKey(ms) { const p = parts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }

  const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
  const tFmt = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
  const t2Fmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: true });
  const dayFmt = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
  const hugeFmt = fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const shortFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
  const stampFmt = fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  function time(ms) { return tFmt.format(ms).replace(':00', ''); }
  function time2(ms) { return t2Fmt.format(ms); }
  function day(ms) { return dayFmt.format(ms); }
  function dayHuge(ms) { return hugeFmt.format(ms); }
  function dayShort(ms) { return shortFmt.format(ms); }
  function stamp(ms) { return stampFmt.format(ms); }

  function relativeDay(ms, now = Date.now()) {
    if (sameDay(ms, now)) return 'today';
    if (sameDay(ms, addDays(now, 1))) return 'tomorrow';
    return day(ms);
  }
  function spoken(ms, now) {
    const rd = relativeDay(ms, now);
    return `${rd === 'today' || rd === 'tomorrow' ? rd : rd} at ${time(ms)}`;
  }

  function nextBusinessDay(now = Date.now()) {
    let d = addDays(dayStart(now), 1);
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  }

  return { parts, make, addDays, dayStart, at, sameDay, isWeekend, iso, dateKey, time, time2, day, dayHuge, dayShort, stamp, relativeDay, spoken, nextBusinessDay, WD };
})();
