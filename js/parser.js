const Parse = (() => {
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const MINS = { "o'clock": '00', oclock: '00', fifteen: '15', thirty: '30', 'forty five': '45', 'forty-five': '45' };

  function normalize(text) {
    let t = ' ' + String(text).toLowerCase().replace(/[’]/g, "'") + ' ';
    t = t.replace(/\bp\.\s?m\.?/g, 'pm').replace(/\ba\.\s?m\.?/g, 'am');
    t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(o'?clock|fifteen|thirty|forty[ -]five)\b/g,
      (_, n, m) => `${NUM[n]}:${MINS[m.replace('-', ' ')] ?? '00'}`);
    t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm)\b/g, (_, n, ap) => `${NUM[n]} ${ap}`);
    t = t.replace(/\bat (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (_, n) => `at ${NUM[n]}`);
    return t.replace(/\s+/g, ' ');
  }

  const has = (t, re) => re.test(t);

  function intent(raw) {
    const t = normalize(raw);
    return {
      transfer: has(t, /hot brisket|emergenc|gas leak|smell (gas|smoke|burning)|carbon monoxide|\bco alarm|smoke|on fire|sparking|flooding|talk to (a |an )?(human|person|someone|sam)|real person/),
      cancel: has(t, /\bcancel/),
      reschedule: has(t, /reschedul|move (my|the|it)|change (my|the) (appointment|booking|time)|push (it|my|the)|update (my|the) (appointment|booking)|different time for my/),
      book: has(t, /\bbook|schedul|appointment|come out|send (someone|a tech)|set (something |it )?up|get someone|technician|tech out|estimate|tune.?up|repair|install|fix|service (call|visit)|take a look|look at (it|my)/),
      hours: has(t, /hours|are you open|what time do you|when do you (open|close)|open on (saturday|sunday|weekend)/),
      price: has(t, /price|pricing|how much|cost|charge|fee|quote/),
      services: has(t, /what (services|do you (do|offer))|services do|do you (install|repair|service|work on)/),
      phone: has(t, /(your|the) (phone )?number|call you back/),
      bye: has(t, /\b(bye|goodbye|that'?s (all|it)|that is all|nothing else|no,? thanks?|no thank you|hang up|have a (good|great) (day|one))\b/),
    };
  }

  const isYes = (raw) => /^\s*(yes|yeah|yea|yep|yup|sure|correct|right|ok|okay|perfect|great|absolutely|definitely|please|go ahead|do it|let'?s do|sounds good|that works|works for me|book it|lock it)/i.test(raw) || /\b(that works|sounds good|works for me)\b/i.test(raw);
  const isNo = (raw) => /^\s*(no|nope|nah|not really|i'?d rather not|don'?t|just cancel)/i.test(raw);

  function ordinal(raw) {
    const t = normalize(raw);
    if (/\b(first|1st|earliest|earlier one)\b/.test(t)) return 0;
    if (/\b(second|2nd|middle)\b/.test(t)) return 1;
    if (/\b(third|3rd)\b/.test(t)) return 2;
    if (/\b(last|latest|later one)\b/.test(t)) return -1;
    return null;
  }

  const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, tues: 2, wednesday: 3, thursday: 4, thurs: 4, friday: 5, saturday: 6 };
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function inferHour(h) {
    if (h >= 13) return h;
    if (h === 12) return 12;
    return h <= 7 ? h + 12 : h;
  }

  function parseWhen(raw, now = Date.now()) {
    const t = normalize(raw);
    const today = Time.dayStart(now);
    let day = null;
    let m;

    if (/\bday after tomorrow\b/.test(t)) day = Time.addDays(today, 2);
    else if (/\btomorrow\b/.test(t)) day = Time.addDays(today, 1);
    else if (/\b(today|this (morning|afternoon)|later today)\b/.test(t)) day = today;
    else if ((m = t.match(/\b(next |this |on )?(sunday|monday|tuesday|tues|wednesday|thursday|thurs|friday|saturday)\b/))) {
      const target = WEEKDAYS[m[2]];
      let diff = (target - Time.parts(today).wd + 7) % 7;
      if (diff === 0) diff = 7;
      if (m[1] === 'next ' && diff < 3) diff += 7;
      day = Time.addDays(today, diff);
    } else if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?\b/))) {
      const p = Time.parts(now);
      const mo = MONTHS.indexOf(m[1]) + 1;
      day = Time.make(p.y, mo, +m[2]);
      if (day < today) day = Time.make(p.y + 1, mo, +m[2]);
    } else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\b/))) {
      const p = Time.parts(now);
      day = Time.make(p.y, +m[1], +m[2]);
      if (day < today) day = Time.make(p.y + 1, +m[1], +m[2]);
    } else if ((m = t.match(/\bthe (\d{1,2})(st|nd|rd|th)\b/))) {
      const p = Time.parts(now);
      day = Time.make(p.y, p.m, +m[1]);
      if (day < today) day = Time.make(p.y, p.m + 1, +m[1]);
    }

    let h = null;
    let min = 0;
    if (/\b(noon|midday|lunchtime)\b/.test(t)) h = 12;
    else if ((m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) {
      h = +m[1] % 12 + (m[3] === 'pm' ? 12 : 0);
      min = +(m[2] || 0);
    } else if ((m = t.match(/\b(\d{1,2}):(\d{2})\b/))) {
      h = inferHour(+m[1]);
      min = +m[2];
    } else if ((m = t.match(/\b(?:at|around|by) (\d{1,2})\b(?!\s*(st|nd|rd|th|\/|%))/))) {
      h = inferHour(+m[1]);
    } else if (/\bfirst thing\b/.test(t)) h = 8;
    else if (/\bmorning\b/.test(t)) h = 9;
    else if (/\bafternoon\b/.test(t)) h = 14;
    else if (/\bevening\b/.test(t)) h = 17;

    if (h !== null && (h > 23 || min > 59)) h = null;
    return { day, hour: h, minute: min, hasDate: day !== null, hasTime: h !== null };
  }

  const STOP_LOCAL = new Set(['is', 'email', 'e-mail', 'my', "it's", 'its', 'mail', 'address', 'sure', 'yeah', 'yes', 'ok', 'okay', 'that', 'the', 'spelled', 'spell', 'it']);

  function parseEmail(raw) {
    let t = String(raw).toLowerCase().replace(/[’]/g, "'");
    if (!t.includes('@')) t = t.replace(/\s+(at|at direct)\s+/g, ' @ ');
    t = t.replace(/\bdot\b/g, ' . ').replace(/\b(underscore|under score)\b/g, ' _ ').replace(/\b(dash|hyphen)\b/g, ' - ');
    t = t.replace(/@/g, ' @ ').replace(/,/g, ' ').replace(/\.(?=\S)/g, ' . ').replace(/\s+/g, ' ').trim();
    const tokens = t.split(' ').map((tok) => (/^([a-z0-9]-)+[a-z0-9]\.?$/.test(tok) ? tok.replace(/-/g, '') : tok));
    const at = tokens.indexOf('@');
    if (at < 1) return null;

    const local = [];
    const punct = (x) => /^[._-]$/.test(x);
    for (let i = at - 1; i >= 0; i--) {
      const tok = tokens[i].replace(/[^a-z0-9._-]/g, '');
      if (!tok) break;
      const single = tok.length === 1;
      if (STOP_LOCAL.has(tokens[i])) break;
      if (single || !local.length || punct(local[0]) || (local[0].length === 1 && tok.length === 1)) local.unshift(tok);
      else break;
      if (!single && local.length > 1 && !punct(local[1])) break;
    }

    const domain = [];
    for (let i = at + 1; i < tokens.length; i++) {
      const tok = tokens[i].replace(/[^a-z0-9.-]/g, '');
      if (!tok) break;
      domain.push(tok);
      const joined = domain.join('');
      const next = tokens[i + 1] || '';
      if (/\.[a-z]{2,}$/.test(joined) && next !== '.' && !next.startsWith('.')) break;
    }
    const email = `${local.join('').replace(/^[._-]+/, '')}@${domain.join('').replace(/\.+$/, '')}`;
    return N8N.isEmail(email) && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) ? email : null;
  }

  const NAME_STOP = new Set(['and', 'i', 'calling', 'with', 'my', 'here', 'from', 'looking', 'need', 'want', 'but', 'so', 'please', 'thanks', 'thank', 'hi', 'hello', 'hey', 'the', 'a', 'about', 'to', 'just', 'having', 'is']);
  const NOT_NAMES = /\b(book|appointment|schedule|cancel|reschedul|email|gmail|tomorrow|today|monday|tuesday|wednesday|thursday|friday|am|pm|ac|heat|furnace|help|yes|no|okay|sure|fine|good|great|calling|need|want)\b/;
  const cap = (w) => w.split(/([-'])/).map((p) => (p.length > 1 ? p[0].toUpperCase() + p.slice(1) : p)).join('');

  function takeName(str) {
    const words = [];
    for (const w of str.trim().split(/\s+/)) {
      const clean = w.replace(/[^a-z'-]/gi, '');
      if (!clean || NAME_STOP.has(clean.toLowerCase())) break;
      words.push(cap(clean.toLowerCase()));
      if (words.length === 3) break;
    }
    return words.length ? words.join(' ') : null;
  }

  function parseName(raw, awaiting) {
    const t = String(raw).toLowerCase().replace(/[’]/g, "'");
    let m = t.match(/\b(?:my name is|my name's|name is|call me)\s+(.+)/);
    if (!m && awaiting) m = t.match(/\b(?:this is|i am|i'm|it's|its|it is)\s+(.+)/);
    if (m) return takeName(m[1]);
    if (!awaiting) return null;
    const bare = t.replace(/\b(yeah|yes|sure|uh|um|umm|okay|ok|well|oh|hi|hello)\b/g, ' ').replace(/[^a-z'\s-]/g, ' ').trim();
    const words = bare.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 3 && !NOT_NAMES.test(bare)) return takeName(bare);
    return null;
  }

  const ISSUE = /(\ba\/?c\b|air ?condition|heat(er|ing)?\b|furnace|thermostat|duct|hvac|not cooling|not heating|warm air|cold air|leak|nois|rattl|tune.?up|maintenance|install|estimate|repair|broke|blowing|filter|heat pump|mini.?split|water heater|compressor|freon|refrigerant|smell|unit|vent|humid)/i;

  function parseReason(raw) {
    if (!ISSUE.test(raw)) return null;
    let s = String(raw).trim().replace(/\s+/g, ' ');
    s = s.replace(/^(hi|hey|hello|yeah|yes|so|well|um+|uh)[,.!\s]+/i, '').replace(/^(hi|hey|hello)[,.!\s]+/i, '');
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/[.!?]*$/, '.');
  }

  function titleFor(notes = '') {
    const n = notes.toLowerCase();
    if (/install|new (unit|system)|replace|mini.?split|heat pump/.test(n)) return 'Installation estimate';
    if (/tune.?up|maintenance|check.?up|inspection/.test(n)) return 'Maintenance tune-up';
    if (/furnace|heat(er|ing)?\b|not heating|cold air/.test(n)) return 'Heating repair';
    if (/\ba\/?c\b|air ?condition|cool|warm air|freon|refrigerant|compressor/.test(n)) return 'AC repair';
    if (/thermostat/.test(n)) return 'Thermostat service';
    if (/duct|vent|filter|humid|smell/.test(n)) return 'Air quality / ductwork';
    return 'HVAC service visit';
  }

  return { normalize, intent, isYes, isNo, ordinal, parseWhen, parseEmail, parseName, parseReason, titleFor };
})();
