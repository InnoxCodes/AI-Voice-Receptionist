// Browser re-implementation of the n8n "Voice Receptionist" workflow.
// Node names, branches and payload shapes mirror the exported JSON.
const N8N = (() => {
  const WORKFLOWS = {
    getslots: { title: 'Get Slots', tool: 'GetSlots', path: '/webhook/getslots', color: 'cool' },
    bookslots: { title: 'Book Slot', tool: 'BookSlot', path: '/webhook/bookslots', color: 'ok' },
    updateslots: { title: 'Update Slots', tool: 'UpdateSlots', path: '/webhook/updateslots', color: 'violet' },
    cancelslots: { title: 'Cancel Slots', tool: 'CancelSlots', path: '/webhook/cancelslots', color: 'err' },
    callresults: { title: 'Call Result Logs', tool: 'end-of-call-report', path: '/webhook/callresults', color: 'heat' },
  };

  const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
  const busy = (events, s, e, ignoreId) => events.filter((ev) => ev.status !== 'cancelled' && ev.id !== ignoreId && overlaps(s, e, ev.start, ev.end));
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || '');

  function vapiBody(fnName, args, call) {
    return {
      message: {
        type: 'tool-calls',
        toolCalls: [{ id: Store.rid('call_', 24), type: 'function', function: { name: fnName, arguments: args } }],
        call: { id: call.id, orgId: 'org_harrison_demo', customer: { number: call.customer } },
        assistant: { id: 'asst_ellie_demo', name: 'Ellie' },
      },
    };
  }

  function respond(body, result) {
    return { results: [{ toolCallId: body.message.toolCalls[0].id, result }] };
  }

  function exec(workflow, request, steps, response, data) {
    const s = Store.get();
    s.executions = (s.executions || 0) + 1;
    return { id: s.executions, workflow, ...WORKFLOWS[workflow], request, steps, response, data, at: Date.now() };
  }

  // "Available Start Times & Ranges" Code node, with the workday window matching business hours.
  function computeAvailability(events, now) {
    const days = [];
    let day = Time.dayStart(now);
    const horizon = now + 7 * 24 * 60 * MIN;
    for (; day < horizon; day = Time.addDays(day, 1)) {
      if (Time.isWeekend(day)) continue;
      const open = Time.at(day, BUSINESS.open);
      const close = Time.at(day, BUSINESS.close);
      const dayEvents = events.filter((e) => e.status !== 'cancelled' && overlaps(open, close, e.start, e.end)).sort((a, b) => a.start - b.start);
      const slots = [];
      let cursor = open;
      const pushGap = (from, to) => {
        let t = Math.ceil(from / SLOT) * SLOT;
        for (; t + SLOT <= to; t += SLOT) if (t > now) slots.push(t);
      };
      for (const ev of dayEvents) {
        if (ev.start > cursor) pushGap(cursor, ev.start);
        cursor = Math.max(cursor, ev.end);
      }
      if (cursor < close) pushGap(cursor, close);
      const ranges = [];
      let runStart = 0;
      for (let i = 1; i <= slots.length; i++) {
        if (i === slots.length || slots[i] - slots[i - 1] !== SLOT) {
          if (i - runStart >= 3) ranges.push([slots[runStart], slots[i - 1]]);
          runStart = i;
        }
      }
      if (slots.length) days.push({ day, slots, ranges, events: dayEvents });
    }
    return days;
  }

  function availabilityText(days) {
    return days.map(({ day, slots, ranges }) => {
      const times = slots.map((t) => `- ${Time.time2(t)}`).join('\n');
      const r = ranges.length ? `Wide Open Ranges:\n${ranges.map(([a, b]) => `- ${Time.time2(a)} to ${Time.time2(b)}`).join('\n')}` : 'Wide Open Ranges: None';
      return `### ${Time.dayHuge(day)}\nAvailable Start Times:\n${times}\n\n${r}`;
    }).join('\n\n');
  }

  function getSlots(args, call) {
    const s = Store.get();
    const body = vapiBody('GetSlots', { starttime: args.starttime, endtime: args.endtime }, call);
    const start = Date.parse(args.starttime);
    const end = args.endtime ? Date.parse(args.endtime) : start + 60 * MIN;
    const conflicts = busy(s.events, start, end);
    const available = conflicts.length === 0;
    const steps = [
      { node: 'Getslot_tool', type: 'webhook', detail: 'POST /getslots · responseMode: responseNode' },
      { node: 'Input Arguments', type: 'set', detail: `timeZone=America/Chicago · starttime=${args.starttime}` },
      { node: 'Check Availability', type: 'gcal', detail: `calendar.freeBusy ${Time.time(start)}–${Time.time(end)} → available: ${available}` },
      { node: 'Check if time is available or not', type: 'if', detail: `$json.available is true`, branch: available ? 'true' : 'false' },
    ];
    let result;
    let days = [];
    if (available) {
      steps.push(
        { node: 'Time available (true) & Call_id', type: 'set', detail: 'available=true, toolCallId' },
        { node: 'Response', type: 'respond', detail: 'result: "available:true"' },
      );
      result = 'available:true';
    } else {
      const now = Date.now();
      const week = s.events.filter((e) => e.start >= now && e.start <= now + 7 * 24 * 60 * MIN);
      days = computeAvailability(s.events, now);
      const text = availabilityText(days);
      const cleaned = text.replace(/\\n/g, ' ').replace(/\s*:\s*/g, ':').replace(/\s+/g, ' ').trim();
      result = `The original time is not available, here are available slots:${cleaned}`;
      steps.push(
        { node: 'Get All Calendar Events', type: 'gcal', detail: `events.list now → +1 week · ${week.length} events` },
        { node: 'Extract start, end and name', type: 'set', detail: 'start, end (DATE_HUGE), name, sort' },
        { node: 'Sort', type: 'itemLists', detail: 'sort by "sort" (start.dateTime)' },
        { node: 'Format response', type: 'itemLists', detail: 'concatenate items → response[]' },
        { node: 'Available Start Times & Ranges', type: 'code', detail: `${days.reduce((n, d) => n + d.slots.length, 0)} open 30-min starts across ${days.length} weekdays` },
        { node: 'Flatten Slots', type: 'code', detail: 'flatten per-date arrays' },
        { node: 'Enrich Date', type: 'code', detail: 'Intl.DateTimeFormat America/Chicago' },
        { node: 'Build Response Payload', type: 'set', detail: 'results[0].result = availableTimes' },
        { node: 'Convert into Json format for Vapi', type: 'code', detail: 'collapse newlines & whitespace' },
        { node: 'Response to Vapi', type: 'respond', detail: '"The original time is not available…"' },
      );
    }
    return exec('getslots', body, steps, respond(body, result), { available, conflicts, days, start, end });
  }

  function bookSlot(args, call) {
    const s = Store.get();
    const body = vapiBody('BookSlot', args, call);
    const steps = [
      { node: 'bookslots_tool', type: 'webhook', detail: 'POST /bookslots' },
      { node: 'Input Arguments from booking tools', type: 'set', detail: `name=${args.name} · email=${args.email}` },
    ];
    const hasInfo = isEmail(args.email);
    steps.push({ node: 'Has all information', type: 'if', detail: '($json.email || "").isEmail()', branch: hasInfo ? 'true' : 'false' });
    if (!hasInfo) {
      const result = 'You must provide an email, name and notes to call this tool';
      steps.push(
        { node: 'Build Error Response Payload', type: 'set', detail: result, status: 'error' },
        { node: 'Respond with Error', type: 'respond', detail: 'error returned to Vapi', status: 'error' },
      );
      return exec('bookslots', body, steps, respond(body, result), { ok: false, reason: 'invalid' });
    }
    const start = Date.parse(args.starttime);
    const end = Date.parse(args.endtime);
    steps.push(
      { node: 'Escape Json', type: 'code', detail: 'escape quotes/newlines in notes' },
      { node: 'Convert time to CST America / Chicago', type: 'code', detail: `${Time.iso(start)} → ${Time.iso(end)}` },
    );
    const clash = busy(s.events, start, end);
    if (clash.length) {
      const result = 'This time slot is no longer available.';
      steps.push(
        { node: 'Create Event', type: 'gcal', detail: `conflict with "${clash[0].summary}" → error output`, branch: 'error', status: 'error' },
        { node: 'Add Friendly Error', type: 'code', detail: 'no_available_users_found_error → friendly text', status: 'error' },
        { node: 'Error Response', type: 'set', detail: result, status: 'error' },
        { node: 'Respond to Vapi', type: 'respond', detail: `result: "${result}"`, status: 'error' },
      );
      return exec('bookslots', body, steps, respond(body, result), { ok: false, reason: 'conflict' });
    }
    const event = {
      id: Store.rid('', 26).toLowerCase(), summary: args.Title || 'HVAC appointment', description: args.notes, start, end,
      attendees: [{ email: args.email, responseStatus: 'needsAction' }], hangoutLink: Store.meetLink(), status: 'confirmed', source: 'ellie',
    };
    s.events.push(event);
    const record = {
      id: Store.rid('rec', 14), createdAt: Date.now(),
      Name: args.name, Email: args.email, 'Phone Number': call.customer, 'Booking Status': 'confirmed',
      CallRecordingId: [call.id], starttime: Time.iso(start), endtime: Time.iso(end), meetlink: event.hangoutLink,
      meetdescription: `${event.summary} ${args.notes}`, 'Voice Agent': ['Ellie'], eventId: event.id,
    };
    s.appointments.push(record);
    Store.save();
    steps.push(
      { node: 'Create Event', type: 'gcal', detail: `events.insert "${event.summary}" + Google Meet`, branch: 'success' },
      { node: 'Booking Payload', type: 'set', detail: `id, startTime, endTime, status=confirmed, hangoutLink` },
      { node: 'Success Response', type: 'set', detail: 'results[0].result = status' },
      { node: 'Respond to Vapi', type: 'respond', detail: 'result: "available:confirmed"' },
      { node: 'If the booking is confirmed then true', type: 'if', detail: 'result equals "confirmed"', branch: 'true' },
      { node: 'Information to be Saved in Airtable', type: 'set', detail: 'attendee, call.id, event.id, customer_number' },
      { node: 'Logs the confirmed booking details', type: 'airtable', detail: `Appointments.create → ${record.id}` },
    );
    return exec('bookslots', body, steps, respond(body, 'available:confirmed'), { ok: true, event, record });
  }

  function findByPhone(call, starttime) {
    const s = Store.get();
    const rows = s.appointments.filter((r) => r['Phone Number'] === call.customer && r['Booking Status'] !== 'Canceled');
    const target = Date.parse(starttime);
    const match = rows.find((r) => Math.abs(Date.parse(r.starttime) - target) < MIN) || null;
    return { rows, match };
  }

  function updateSlots(args, call) {
    const s = Store.get();
    const body = vapiBody('UpdateSlots', args, call);
    const steps = [
      { node: 'Updateslots_tool', type: 'webhook', detail: 'POST /updateslots' },
      { node: 'Input Arguments from updateslot tool', type: 'set', detail: `starttime=${args.starttime} · Rescheduled_starttime=${args.Rescheduled_starttime}` },
    ];
    const hasInfo = !!(args.name && args.email && args.starttime && args.Rescheduled_starttime && args.Rescheduled_endttime);
    steps.push({ node: 'Checks if required info is provided.', type: 'if', detail: 'name, email, starttime, Rescheduled_start/end exist', branch: hasInfo ? 'true' : 'false' });
    if (!hasInfo) {
      const result = 'You must provide an email, name , previous starttime & endtime and resceduled starttime to call this tool';
      steps.push(
        { node: 'Build Error Response Payload2', type: 'set', detail: 'missing arguments', status: 'error' },
        { node: 'Response with Error', type: 'respond', detail: 'error returned to Vapi', status: 'error' },
      );
      return exec('updateslots', body, steps, respond(body, result), { ok: false, reason: 'invalid' });
    }
    const { rows, match } = findByPhone(call, args.starttime);
    steps.push({ node: 'Finds original appointment', type: 'airtable', detail: `filterByFormula {Phone Number} = "${call.customer}" → ${rows.length} record(s)${match ? ', matched starttime' : ''}`, status: match ? 'ok' : 'error' });
    if (!match) {
      steps.push({ node: 'Update Event', type: 'gcal', detail: 'no input items — execution stops', status: 'skip' });
      return exec('updateslots', body, steps, respond(body, 'No appointment found for this caller'), { ok: false, reason: 'notfound' });
    }
    const event = s.events.find((e) => e.id === match.eventId);
    const newStart = Date.parse(args.Rescheduled_starttime);
    const newEnd = Date.parse(args.Rescheduled_endttime);
    if (event) { event.start = newStart; event.end = newEnd; }
    match.starttime = Time.iso(newStart);
    match.endtime = Time.iso(newEnd);
    match['Booking Status'] = 'Updated/Rescheduled';
    match.updatedAt = Date.now();
    Store.save();
    steps.push(
      { node: 'Update Event', type: 'gcal', detail: `events.patch ${match.eventId.slice(0, 10)}… → ${Time.dayShort(newStart)} ${Time.time(newStart)}`, branch: 'success' },
      { node: 'Updates Airtable record', type: 'airtable', detail: `match eventId · Booking Status = "Updated/Rescheduled"` },
      { node: 'Response & call_id', type: 'set', detail: 'results[0].result = fields["Booking Status"]' },
      { node: 'Respond to Vapi about Updating slots', type: 'respond', detail: 'result: "Updated/Rescheduled"' },
    );
    return exec('updateslots', body, steps, respond(body, 'Updated/Rescheduled'), { ok: true, record: match, event });
  }

  function cancelSlots(args, call) {
    const s = Store.get();
    const body = vapiBody('CancelSlots', args, call);
    const steps = [
      { node: 'CancelSlots_tool', type: 'webhook', detail: 'POST /cancelslots' },
      { node: 'Input Arguments from cancelslot tool', type: 'set', detail: `starttime=${args.starttime} · Cancelnotes` },
    ];
    const hasInfo = !!(args.name && args.email && args.starttime);
    steps.push({ node: 'Checks if required info is provided for cancelation', type: 'if', detail: 'name, email, starttime exist', branch: hasInfo ? 'true' : 'false' });
    if (!hasInfo) {
      const result = 'You must provide an email, name and starttime to call this tool';
      steps.push(
        { node: 'Build Error Response', type: 'set', detail: 'missing arguments', status: 'error' },
        { node: 'Respond with Error to Vapi', type: 'respond', detail: 'error returned to Vapi', status: 'error' },
      );
      return exec('cancelslots', body, steps, respond(body, result), { ok: false, reason: 'invalid' });
    }
    const { rows, match } = findByPhone(call, args.starttime);
    steps.push({ node: 'Finds the appointment record', type: 'airtable', detail: `filterByFormula {Phone Number} = "${call.customer}" → ${rows.length} record(s)${match ? ', matched starttime' : ''}`, status: match ? 'ok' : 'error' });
    if (!match) {
      steps.push(
        { node: 'Delete Event', type: 'gcal', detail: 'eventId undefined → error output', branch: 'error', status: 'error' },
        { node: 'Call_id & Response', type: 'set', detail: 'results[0].result = $json.error', status: 'error' },
        { node: 'Respond to Vapi about cancelation', type: 'respond', detail: 'error returned to Vapi', status: 'error' },
      );
      return exec('cancelslots', body, steps, respond(body, 'No appointment found for this caller'), { ok: false, reason: 'notfound' });
    }
    s.events = s.events.filter((e) => e.id !== match.eventId);
    match['Booking Status'] = 'Canceled';
    match.cancelNotes = args.Cancelnotes || '';
    match.updatedAt = Date.now();
    Store.save();
    steps.push(
      { node: 'Delete Event', type: 'gcal', detail: `events.delete ${match.eventId.slice(0, 10)}… · sendUpdates: all`, branch: 'success' },
      { node: 'Update Airtable record', type: 'airtable', detail: 'match eventId · Booking Status = "Canceled"' },
      { node: 'Call_id & Response', type: 'set', detail: 'results[0].result = fields["Booking Status"]' },
      { node: 'Respond to Vapi about cancelation', type: 'respond', detail: 'result: "Canceled"' },
    );
    return exec('cancelslots', body, steps, respond(body, 'Canceled'), { ok: true, record: match });
  }

  function callResults(report) {
    const s = Store.get();
    const body = {
      message: {
        type: 'end-of-call-report',
        artifact: { transcript: report.transcript, recordingUrl: `(simulated) ${report.callId}-mono.wav` },
        analysis: { summary: report.summary },
        cost: report.cost, startedAt: new Date(report.startedAt).toISOString(), endedAt: new Date(report.endedAt).toISOString(),
        call: { id: report.callId, orgId: 'org_harrison_demo', assistantId: 'asst_ellie_demo', customer: { number: report.customer } },
        assistant: { id: 'asst_ellie_demo', name: 'Ellie', model: { model: 'gpt-4o', emotionRecognitionEnabled: true } },
      },
    };
    const row = {
      id: Store.rid('rec', 14), callrecording_id: report.callId, Cost: report.cost,
      'Call recording Url': body.message.artifact.recordingUrl, transcript: report.transcript,
      customer_Number: report.customer, startedAt: body.message.startedAt, endedAt: body.message.endedAt,
      callsummary: report.summary, duration: Math.round((report.endedAt - report.startedAt) / 1000),
    };
    s.calls.push(row);
    Store.save();
    const steps = [
      { node: 'call_results', type: 'webhook', detail: 'POST /callresults · end-of-call-report' },
      { node: 'All Input Arguments', type: 'set', detail: `transcript, recordingUrl, summary, cost=$${report.cost.toFixed(3)}` },
      { node: 'Save all information', type: 'airtable', detail: `Call Recording.upsert on callrecording_id → ${row.id}` },
    ];
    return exec('callresults', body, steps, { received: true }, { row });
  }

  return { WORKFLOWS, getSlots, bookSlot, updateSlots, cancelSlots, callResults, computeAvailability, availabilityText, busy, isEmail };
})();
