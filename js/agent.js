// Ellie: a deterministic stand-in for the Vapi LLM that follows the system prompt's rules
// (gather name → spelled email → reason → time, check GetSlots first, never book weekends, etc.)
function phraseFor(ms, now = Date.now()) {
  const t = Time.time(ms).toLowerCase();
  if (Time.sameDay(ms, now)) return `today at ${t}`;
  if (Time.sameDay(ms, Time.addDays(now, 1))) return `tomorrow at ${t}`;
  if (ms - now < 6 * 24 * 60 * MIN) return `${Time.day(ms).split(',')[0]} at ${t}`;
  return `${Time.day(ms).split(', ')[1]} at ${t}`;
}

function spellEmail(email) {
  const [local, domain] = email.split('@');
  const common = /^(gmail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|live|msn|me)\./.test(domain);
  const spell = (s) => s.split('').map((c) => (c === '.' ? 'dot' : c === '_' ? 'underscore' : c === '-' ? 'dash' : c.toUpperCase())).join(' - ');
  const dom = common ? domain.replace(/\./g, ' dot ') : spell(domain.split('.')[0]) + ' dot ' + domain.split('.').slice(1).join(' dot ');
  return `${spell(local)} at ${dom}`;
}

function createEllie(hooks) {
  let ctx;
  let call;
  let busy = false;

  const FIRST_MESSAGE = 'Hi, this is Ellie with Harrison Climate Solutions. How can I help you?';

  function reset() {
    ctx = {
      intent: null, awaiting: 'intent', misses: 0,
      name: null, email: null, notes: null, emailFresh: false,
      pendingDay: null, start: null, prevStart: null, newStart: null,
      verified: {}, offered: [], pickFor: null,
      offeredReschedule: false, cancelNotes: null, askedCancelNotes: false,
      outcomes: [], transcript: [],
    };
  }
  reset();

  const first = () => (ctx.name || '').split(' ')[0];

  async function say(text, speech) {
    ctx.transcript.push({ role: 'AI', text });
    await hooks.say(text, speech || text);
  }

  async function tool(fn) { return hooks.tool(fn); }

  function setIntent(intent) {
    if (ctx.intent === intent) return;
    ctx.intent = intent;
    ctx.start = ctx.prevStart = ctx.newStart = null;
    ctx.pendingDay = null;
    ctx.verified = {};
    ctx.offered = [];
    ctx.offeredReschedule = false;
    ctx.askedCancelNotes = false;
    ctx.cancelNotes = null;
    ctx.misses = 0;
  }

  function resolveWhen(p, now = Date.now()) {
    if (p.hasDate && !p.hasTime) { ctx.pendingDay = p.day; return null; }
    if (!p.hasTime) return null;
    let day = p.day || ctx.pendingDay;
    if (!day) {
      const today = Time.at(now, p.hour, p.minute);
      day = today > now + 20 * MIN && !Time.isWeekend(now) ? Time.dayStart(now) : Time.nextBusinessDay(now);
    }
    ctx.pendingDay = null;
    return Time.at(day, p.hour, p.minute);
  }

  function validate(ms) {
    const now = Date.now();
    const p = Time.parts(ms);
    if (ms < now) return "Ha, I'd love to, but our techs haven't figured out time travel just yet. What's a time coming up that works?";
    if (Time.isWeekend(ms)) return "Well, we don't book on weekends. We're open Monday through Friday, 8 AM to 5 PM. Would a weekday work instead?";
    if (p.h < BUSINESS.open || p.h * 60 + p.min + 30 > BUSINESS.close * 60) return 'Hmm, that one\'s outside our hours. We book between 8 AM and 5 PM Central. What time in that window works?';
    if (ms - now > 60 * 24 * 60 * MIN) return "We only book about two months out. Could you pick something a bit sooner?";
    return null;
  }

  function pickOptions(days, requested) {
    const all = days.flatMap((d) => d.slots);
    const sameDay = all.filter((t) => Time.sameDay(t, requested));
    let picks;
    if (sameDay.length) {
      picks = sameDay.slice().sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested)).slice(0, 3).sort((a, b) => a - b);
    } else {
      const later = all.filter((t) => t > requested);
      const pool = later.length ? later : all;
      picks = pool.filter((t) => Time.sameDay(t, pool[0])).slice(0, 3);
    }
    return picks;
  }

  function describeOptions(picks) {
    if (!picks.length) return '';
    const sameDay = picks.every((t) => Time.sameDay(t, picks[0]));
    const times = picks.map((t) => (sameDay ? Time.time(t) : phraseFor(t)));
    const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(', ')} or ${times[times.length - 1]}`;
    if (!sameDay) return list;
    const day = phraseFor(picks[0]).replace(/ at .*/, '');
    return `${list} ${/today|tomorrow/.test(day) ? day : `on ${day}`}`;
  }

  function absorb(text, it) {
    const aw = ctx.awaiting;
    const emailLike = /@| at .+ dot |\bdot com\b/i.test(text);

    if (aw === 'name' || !ctx.name) {
      const n = Parse.parseName(text, aw === 'name' && !emailLike);
      if (n) ctx.name = n;
    }
    if (aw === 'email' || emailLike) {
      const e = Parse.parseEmail(text);
      if (e) { ctx.email = e; ctx.emailFresh = true; }
    }
    if (!ctx.notes) {
      const r = Parse.parseReason(text);
      if (r) ctx.notes = r;
      else if (aw === 'notes' && text.trim().split(/\s+/).length >= 2) ctx.notes = text.trim().replace(/[.!?]*$/, '.');
    }
    if (aw === 'cancelNotes') ctx.cancelNotes = Parse.isNo(text) ? 'No reason given.' : text.trim();

    if (aw === 'pickSlot') return;
    const p = Parse.parseWhen(text);
    if (!p.hasDate && !p.hasTime) return;
    const ms = resolveWhen(p);
    if (ms === null) return;
    if (ctx.intent === 'reschedule') {
      if (aw === 'newTime' || (ctx.prevStart && ctx.verified.prev === ctx.prevStart)) ctx.newStart = ms;
      else ctx.prevStart = ms;
    } else if (ctx.intent === 'cancel') ctx.start = ms;
    else ctx.start = ms;
  }

  function handlePick(text) {
    const idx = Parse.ordinal(text);
    let chosen = null;
    if (idx !== null) chosen = ctx.offered[idx === -1 ? ctx.offered.length - 1 : idx] ?? null;
    if (chosen === null) {
      const p = Parse.parseWhen(text);
      if (p.hasTime) {
        const match = ctx.offered.find((t) => {
          const tp = Time.parts(t);
          return tp.h === p.hour && tp.min === p.minute && (!p.hasDate || Time.sameDay(t, p.day));
        });
        if (match) chosen = match;
        else {
          const ms = resolveWhen({ ...p, day: p.day || ctx.offered[0] });
          if (ms !== null) { ctx[ctx.pickFor] = ms; ctx.offered = []; return 'new'; }
        }
      } else if (p.hasDate) {
        ctx.pendingDay = p.day;
        ctx[ctx.pickFor] = null;
        ctx.offered = [];
        return 'new';
      }
    }
    if (chosen === null && Parse.isYes(text) && ctx.offered.length === 1) chosen = ctx.offered[0];
    if (chosen !== null) {
      ctx[ctx.pickFor] = chosen;
      ctx.verified[ctx.pickFor] = chosen;
      ctx.offered = [];
      return 'picked';
    }
    if (Parse.isNo(text)) { ctx[ctx.pickFor] = null; ctx.offered = []; return 'none'; }
    return 'unclear';
  }

  async function handle(text) {
    if (busy || !call) return;
    busy = true;
    hooks.thinking?.(true);
    try {
      ctx.transcript.push({ role: 'User', text });
      const it = Parse.intent(text);

      if (it.transfer) {
        await say("Oh no, that sounds urgent. I'm transferring you to Sam right now, so please hang tight.");
        ctx.outcomes.push('Caller reported an urgent issue and was transferred to Sam via the TransferCall tool.');
        await hooks.transfer();
        return hooks.end('transferred');
      }

      if (it.cancel) setIntent('cancel');
      else if (it.reschedule) setIntent('reschedule');
      else if (it.book && (!ctx.intent || ctx.awaiting === 'anythingElse')) setIntent('book');

      const answers = [];
      if (it.hours) answers.push("We're open Monday through Friday, 8 AM to 5 PM Central, and for real emergencies we're available 24/7.");
      if (it.price) answers.push('Estimates are always free, and our pricing is totally transparent. No hidden fees, promise.');
      if (it.services) answers.push("We handle AC repair and installs, furnace and heat pump service, ductwork, thermostats and seasonal tune-ups. Right now we've got a summer AC install deal, too.");
      if (it.phone) answers.push('Our number is 415-892-3245.', 'Our number is four one five - eight nine two - three two four five.');

      const ending = (it.bye || Parse.isNo(text)) && (ctx.awaiting === 'anythingElse' || (ctx.awaiting === 'intent' && !ctx.intent));
      if (ending || (it.bye && !ctx.intent)) {
        await say(`Thanks for calling Harrison Climate Solutions${first() ? `, ${first()}` : ''}. Y'all have a great day!`);
        return hooks.end('completed');
      }

      if (ctx.awaiting === 'pickSlot' && ctx.intent) {
        const r = handlePick(text);
        if (r === 'unclear') {
          await say(`Sorry, which one works best: ${describeOptions(ctx.offered)}?`);
          return;
        }
        if (r === 'none') {
          await say('No problem. What day and time would work better for you?');
          ctx.awaiting = ctx.intent === 'reschedule' ? 'newTime' : 'time';
          return;
        }
      } else {
        absorb(text, it);
      }

      if (!ctx.intent && ctx.notes && ctx.awaiting === 'intent') setIntent('book');
      if (ctx.awaiting === 'anythingElse' && Parse.isYes(text) && !ctx.intent) {
        ctx.awaiting = 'intent';
        await say('Sure thing, what can I help with?');
        return;
      }

      await advance(answers);
    } finally {
      busy = false;
      hooks.thinking?.(false);
      hooks.update?.();
    }
  }

  const asAck = (lines) => (Array.isArray(lines) ? { text: lines, speech: lines } : lines);

  async function ask(lines, question, awaiting, speechQuestion) {
    ctx.awaiting = awaiting;
    const a = asAck(lines);
    await say([...a.text, question].join(' '), [...a.speech, speechQuestion || question].join(' '));
  }

  function emailAck(lines) {
    if (ctx.emailFresh && ctx.email) {
      ctx.emailFresh = false;
      return { text: [...lines, `Got it: ${ctx.email}.`], speech: [...lines, `Got it. ${spellEmail(ctx.email)}.`] };
    }
    return { text: lines, speech: lines };
  }

  async function gather(lines, opener) {
    const retry = (field) => ctx.awaiting === field;
    if (!ctx.name) {
      await ask(lines, retry('name') ? "Sorry, I didn't quite catch your name. Could you say it one more time?" : `${opener} Can I get your full name?`, 'name');
      return false;
    }
    if (!ctx.email) {
      const q = retry('email')
        ? "Hmm, I didn't catch that one. Could you spell it out for me, like J - O - H - N at gmail dot com?"
        : `Thanks, ${first()}! Can you spell your email please?`;
      await ask(lines, q, 'email');
      return false;
    }
    return true;
  }

  async function checkSlot(lines, key, label) {
    const ms = ctx[key];
    const { text, speech } = Array.isArray(lines) ? emailAck(lines) : lines;
    await say([...text, `Let me check ${label || phraseFor(ms)} for you, one sec.`].join(' '), [...speech, 'Let me check that for you, one sec.'].join(' '));
    const exec = await tool(() => N8N.getSlots({ starttime: Time.iso(ms), endtime: Time.iso(ms + SLOT) }, call));
    return exec;
  }

  async function advance(lines) {
    if (!ctx.intent) {
      if (lines.length) return ask(lines, 'Anything I can help you book today?', 'intent');
      ctx.misses++;
      return ask([], ctx.misses > 1
        ? 'I can book, reschedule or cancel an appointment, or answer questions about our services. Which one can I help with?'
        : "Well, I can help you book, reschedule or cancel an HVAC appointment. What can I do for ya?", 'intent');
    }
    if (ctx.intent === 'book') return flowBook(lines);
    if (ctx.intent === 'reschedule') return flowReschedule(lines);
    return flowCancel(lines);
  }

  async function flowBook(lines) {
    if (!(await gather(lines, 'Happy to get that set up!'))) return;
    const ack = emailAck(lines);
    if (!ctx.notes) return ask(ack, "And what's going on with your system? Anything our tech should know?", 'notes');
    if (!ctx.start) {
      const q = ctx.pendingDay ? `What time works best ${phraseFor(ctx.pendingDay).replace(/ at .*/, '').replace(/^(?!today|tomorrow)/, 'on ')}?` : 'What day and time would work best for you?';
      return ask(ack, q, 'time');
    }
    const invalid = validate(ctx.start);
    if (invalid) { ctx.start = null; return ask(ack, invalid, 'time'); }

    if (ctx.verified.start !== ctx.start) {
      const exec = await checkSlot(ack, 'start');
      if (!exec.data.available) {
        const picks = pickOptions(exec.data.days, ctx.start);
        if (!picks.length) {
          ctx.start = null;
          return ask([], "Shoot, we're fully booked this week. Could you call back in a few days, or try a date further out?", 'time');
        }
        ctx.offered = picks;
        ctx.pickFor = 'start';
        return ask([], `Umm, ${phraseFor(ctx.start)} is already taken. I've got ${describeOptions(picks)}. Any of those work?`, 'pickSlot');
      }
      ctx.verified.start = ctx.start;
      await say(`Good news, ${phraseFor(ctx.start)} is open. Booking that for you now.`);
    } else {
      await say(`Perfect, locking in ${phraseFor(ctx.start)}.`);
    }

    const title = Parse.titleFor(ctx.notes);
    const exec = await tool(() => N8N.bookSlot({
      name: ctx.name, email: ctx.email, notes: ctx.notes, Title: title,
      starttime: Time.iso(ctx.start), endtime: Time.iso(ctx.start + SLOT),
    }, call));
    if (exec.data.ok) {
      const when = phraseFor(ctx.start);
      ctx.outcomes.push(`${ctx.name} (${ctx.email}) booked "${title}" for ${Time.dayShort(ctx.start)} at ${Time.time(ctx.start)} CT. Notes: ${ctx.notes}`);
      setIntent(null);
      return ask([], `You're all set! ${title} ${when}. A calendar invite with a Google Meet link is headed to ${ctx.email}. Anything else I can help with?`,
        'anythingElse', `You're all set! ${title} ${when}. A calendar invite is headed to your inbox. Anything else I can help with?`);
    }
    if (exec.data.reason === 'conflict') {
      ctx.verified.start = null;
      return flowBook(['Oh shoot, someone just grabbed that slot.']);
    }
    ctx.email = null;
    return ask([], "Hmm, the booking didn't go through because that email looks off. Can you spell it for me again?", 'email');
  }

  async function verifyExisting(lines, key) {
    const exec = await checkSlot(lines, key, 'your booking');
    if (exec.data.available) {
      const when = phraseFor(ctx[key]);
      ctx[key] = null;
      await ask([], `Hmm, I don't see anything booked ${when}. Could you double-check the day and time for me?`, ctx.intent === 'cancel' ? 'time' : 'prevTime');
      return false;
    }
    ctx.verified[key === 'prevStart' ? 'prev' : 'existing'] = ctx[key];
    return true;
  }

  function notFoundLine() {
    return `Hmm, there's something on the calendar then, but not a booking under the number you're calling from, ${fmtPhone(call.customer)}. If it was booked from another phone, give us a ring from that one. Anything else I can help with?`;
  }

  async function flowReschedule(lines) {
    if (!(await gather(lines, 'I can help move that.'))) return;
    const ack = emailAck(lines);
    if (!ctx.prevStart) return ask(ack, 'What day and time is your current appointment?', 'prevTime');
    if (ctx.verified.prev !== ctx.prevStart && !(await verifyExisting(ack, 'prevStart'))) return;
    if (!ctx.newStart) {
      return ask([], `Found it, ${phraseFor(ctx.prevStart)}. And when would you like to move it to?`, 'newTime');
    }
    const invalid = validate(ctx.newStart);
    if (invalid) { ctx.newStart = null; return ask([], invalid, 'newTime'); }

    if (ctx.verified.newStart !== ctx.newStart) {
      const exec = await checkSlot([], 'newStart');
      if (!exec.data.available) {
        const picks = pickOptions(exec.data.days, ctx.newStart);
        ctx.offered = picks;
        ctx.pickFor = 'newStart';
        return ask([], `Well, ${phraseFor(ctx.newStart)} is taken. How about ${describeOptions(picks)}?`, 'pickSlot');
      }
      ctx.verified.newStart = ctx.newStart;
    }

    const exec = await tool(() => N8N.updateSlots({
      name: ctx.name, email: ctx.email,
      starttime: Time.iso(ctx.prevStart), endtime: Time.iso(ctx.prevStart + SLOT),
      Rescheduled_starttime: Time.iso(ctx.newStart), Rescheduled_endttime: Time.iso(ctx.newStart + SLOT),
    }, call));
    if (exec.data.ok) {
      ctx.outcomes.push(`${ctx.name} rescheduled their appointment from ${Time.dayShort(ctx.prevStart)} ${Time.time(ctx.prevStart)} to ${Time.dayShort(ctx.newStart)} ${Time.time(ctx.newStart)} CT.`);
      const when = phraseFor(ctx.newStart);
      setIntent(null);
      return ask([], `Done! I've moved your appointment to ${when}, and an updated invite is on its way. Anything else I can help with?`, 'anythingElse');
    }
    ctx.outcomes.push(`${ctx.name} tried to reschedule, but no appointment was found for the caller's number.`);
    setIntent(null);
    return ask([], notFoundLine(), 'anythingElse');
  }

  async function flowCancel(lines) {
    if (!(await gather(lines, "I can help with that."))) return;
    const ack = emailAck(lines);
    if (!ctx.start) return ask(ack, "What day and time is the appointment you'd like to cancel?", 'time');
    if (ctx.verified.existing !== ctx.start && !(await verifyExisting(ack, 'start'))) return;

    if (!ctx.offeredReschedule) {
      ctx.offeredReschedule = true;
      return ask([], `Okay, I see ${phraseFor(ctx.start)}. Before I cancel, would you rather just move it to another time? Happy to find you a new slot.`, 'offerReschedule');
    }
    if (ctx.awaiting === 'offerReschedule' && Parse.isYes(ctx.transcript[ctx.transcript.length - 1].text)) {
      const prev = ctx.start;
      const { name, email } = ctx;
      setIntent('reschedule');
      Object.assign(ctx, { name, email, prevStart: prev, verified: { prev } });
      return ask([], 'Great, when would you like to move it to?', 'newTime');
    }
    if (!ctx.askedCancelNotes) {
      ctx.askedCancelNotes = true;
      return ask([], "No problem. Mind sharing why you're canceling? It helps us out.", 'cancelNotes');
    }

    const exec = await tool(() => N8N.cancelSlots({
      name: ctx.name, email: ctx.email, starttime: Time.iso(ctx.start), Cancelnotes: ctx.cancelNotes || '',
    }, call));
    if (exec.data.ok) {
      ctx.outcomes.push(`${ctx.name} canceled their ${Time.dayShort(ctx.start)} ${Time.time(ctx.start)} CT appointment. Reason: ${ctx.cancelNotes || 'not given'}`);
      const when = phraseFor(ctx.start);
      setIntent(null);
      return ask([], `All done. Your appointment ${when} is canceled, and you'll get a cancellation email. Anything else I can do for you?`, 'anythingElse');
    }
    ctx.outcomes.push(`${ctx.name} tried to cancel, but no appointment was found for the caller's number.`);
    setIntent(null);
    return ask([], notFoundLine(), 'anythingElse');
  }

  return {
    async start(c) {
      reset();
      call = c;
      busy = true;
      hooks.thinking?.(true);
      await say(FIRST_MESSAGE);
      busy = false;
      hooks.thinking?.(false);
      hooks.update?.();
    },
    stop() { call = null; busy = false; },
    handle,
    get busy() { return busy; },
    get awaiting() { return ctx.awaiting; },
    get ctx() { return ctx; },
    summary() {
      if (ctx.outcomes.length) return ctx.outcomes.join(' ');
      return `Caller${ctx.name ? ` ${ctx.name}` : ''} spoke with Ellie about Harrison Climate Solutions; no appointment changes were made.`;
    },
    transcriptText() { return ctx.transcript.map((l) => `${l.role}: ${l.text}`).join('\n'); },
  };
}
