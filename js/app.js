(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  Store.load();

  const el = {
    nav: $('#nav'), callerNumber: $('#callerNumber'), callStatus: $('#callStatus'), callTimer: $('#callTimer'),
    orb: $('#orb'), orbLabel: $('#orbLabel'), transcript: $('#transcript'), suggestions: $('#suggestions'),
    composer: $('#composer'), micBtn: $('#micBtn'), msgInput: $('#msgInput'), sendBtn: $('#sendBtn'),
    callBtn: $('#callBtn'), voiceToggle: $('#voiceToggle'), handsFree: $('#handsFree'), handsFreeWrap: $('#handsFreeWrap'), sttNote: $('#sttNote'),
    execWorkflow: $('#execWorkflow'), execPath: $('#execPath'), execStatus: $('#execStatus'), execSteps: $('#execSteps'),
    execPayload: $('#execPayload'), execHistory: $('#execHistory'), copyPayload: $('#copyPayload'),
    viewCalendar: $('#viewCalendar'), viewAppointments: $('#viewAppointments'), viewCalls: $('#viewCalls'),
    countAppointments: $('#countAppointments'), countCalls: $('#countCalls'), resetData: $('#resetData'),
    workflowMap: $('#workflowMap'), nodeLegend: $('#nodeLegend'), algoDay: $('#algoDay'), algoTrack: $('#algoTrack'), algoOutput: $('#algoOutput'),
    toast: $('#toast'),
  };

  const TYPE_META = {
    webhook: { label: 'Webhook', abbr: 'W', color: '#a78bfa' },
    set: { label: 'Edit Fields (Set)', abbr: 'S', color: '#8fa3bf' },
    if: { label: 'If', abbr: 'IF', color: '#f5b43c' },
    code: { label: 'Code', abbr: '{}', color: '#ff8a5b' },
    itemLists: { label: 'Item Lists', abbr: 'L', color: '#d4a5ff' },
    gcal: { label: 'Google Calendar', abbr: 'G', color: '#5b8dff' },
    airtable: { label: 'Airtable', abbr: 'A', color: '#2dd4bf' },
    respond: { label: 'Respond to Webhook', abbr: 'R', color: '#34d399' },
  };
  const FLOW_COLORS = { cool: '#2f6bff', ok: '#17a05d', violet: '#7c5cff', err: '#e0433a', heat: '#ff5a1f' };

  // ---------- Workflow map (static, from the n8n export) ----------
  const FLOWS = [
    { key: 'getslots', desc: 'Checks the requested time. If it is busy, it builds a list of open 30-minute slots for the next week.', lanes: [
      { nodes: [['Getslot_tool', 'webhook'], ['Input Arguments', 'set'], ['Check Availability', 'gcal'], ['Check if time is available or not', 'if']] },
      { label: 'true · time is free', nodes: [['Time available (true) & Call_id', 'set'], ['Response', 'respond']] },
      { label: 'false · time is busy', nodes: [['Get All Calendar Events', 'gcal'], ['Extract start, end and name', 'set'], ['Sort', 'itemLists'], ['Format response', 'itemLists'], ['Available Start Times & Ranges', 'code'], ['Flatten Slots', 'code'], ['Enrich Date', 'code'], ['Build Response Payload', 'set'], ['Convert into Json format for Vapi', 'code'], ['Response to Vapi', 'respond']] },
    ] },
    { key: 'bookslots', desc: 'Validates the booking, creates the Calendar event with a Meet link, and logs it to Airtable.', lanes: [
      { nodes: [['bookslots_tool', 'webhook'], ['Input Arguments from booking tools', 'set'], ['Has all information', 'if']] },
      { label: 'true', nodes: [['Escape Json', 'code'], ['Convert time to CST America / Chicago', 'code'], ['Create Event', 'gcal'], ['Booking Payload', 'set'], ['Success Response', 'set'], ['Respond to Vapi', 'respond'], ['If the booking is confirmed then true', 'if'], ['Information to be Saved in Airtable', 'set'], ['Logs the confirmed booking details', 'airtable']] },
      { label: 'Create Event · error output', nodes: [['Add Friendly Error', 'code'], ['Error Response', 'set'], ['Respond to Vapi', 'respond']] },
      { label: 'false · invalid email', nodes: [['Build Error Response Payload', 'set'], ['Respond with Error', 'respond']] },
    ] },
    { key: 'updateslots', desc: "Finds the caller's booking by phone number, moves the event, and marks it Updated/Rescheduled.", lanes: [
      { nodes: [['Updateslots_tool', 'webhook'], ['Input Arguments from updateslot tool', 'set'], ['Checks if required info is provided.', 'if']] },
      { label: 'true', nodes: [['Finds original appointment', 'airtable'], ['Update Event', 'gcal'], ['Updates Airtable record', 'airtable'], ['Response & call_id', 'set'], ['Respond to Vapi about Updating slots', 'respond']] },
      { label: 'Update Event · error output', nodes: [['Response & call_id', 'set'], ['Respond to Vapi about Updating slots', 'respond']] },
      { label: 'false', nodes: [['Build Error Response Payload2', 'set'], ['Response with Error', 'respond']] },
    ] },
    { key: 'cancelslots', desc: "Finds the caller's booking, deletes the event (attendees are notified), and marks it Canceled.", lanes: [
      { nodes: [['CancelSlots_tool', 'webhook'], ['Input Arguments from cancelslot tool', 'set'], ['Checks if required info is provided for cancelation', 'if']] },
      { label: 'true', nodes: [['Finds the appointment record', 'airtable'], ['Delete Event', 'gcal'], ['Update Airtable record', 'airtable'], ['Call_id & Response', 'set'], ['Respond to Vapi about cancelation', 'respond']] },
      { label: 'Delete Event · error output', nodes: [['Call_id & Response', 'set'], ['Respond to Vapi about cancelation', 'respond']] },
      { label: 'false', nodes: [['Build Error Response', 'set'], ['Respond with Error to Vapi', 'respond']] },
    ] },
    { key: 'callresults', desc: "Vapi's end-of-call report: transcript, recording, summary and cost go into the Call Recording table.", lanes: [
      { nodes: [['call_results', 'webhook'], ['All Input Arguments', 'set'], ['Save all information', 'airtable']] },
    ] },
  ];

  function renderWorkflowMap() {
    el.nodeLegend.innerHTML = Object.values(TYPE_META).map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('');
    el.workflowMap.innerHTML = FLOWS.map((f) => {
      const w = N8N.WORKFLOWS[f.key];
      const lanes = f.lanes.map((lane, i) => `
        <div class="lane${i ? ' alt' : ''}">
          ${lane.label ? `<span class="lane-label">↳ ${esc(lane.label)}</span>` : ''}
          ${lane.nodes.map(([n, t], j) => `${j ? '<span class="arrow">→</span>' : ''}<span class="chip-node"><i style="background:${TYPE_META[t].color}"></i>${esc(n)}</span>`).join('')}
        </div>`).join('');
      return `<article class="flow">
        <div class="flow-meta">
          <div class="flow-bar" style="background:${FLOW_COLORS[w.color]}"></div>
          <h4>${esc(w.title)}</h4>
          <code>POST ${esc(w.path)}</code>
          <p>${esc(f.desc)}</p>
        </div>
        <div class="flow-lanes">${lanes}</div>
      </article>`;
    }).join('');
  }

  // ---------- State ----------
  let callActive = false;
  let ending = false;
  let call = null;
  let timer = null;
  let scenarioRunning = false;
  let listening = false;
  let holdRender = false;
  let shownExec = null;
  let payloadTab = 'request';
  const execLog = [];
  let prevEventIds = null;
  let prevApptKeys = null;
  let prevCallIds = null;

  // ---------- Helpers ----------
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function highlight(obj) {
    return esc(JSON.stringify(obj, null, 2)).replace(
      /(&quot;(?:[^&\\]|\\.|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g,
      (m, str, colon) => {
        if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
        return `<span class="n">${m}</span>`;
      },
    );
  }

  function setOrb(state, label) {
    el.orb.dataset.state = state;
    el.orbLabel.textContent = label || (callActive ? 'On the line' : 'Harrison Climate Solutions');
  }

  function scrollTranscript() { el.transcript.scrollTop = el.transcript.scrollHeight; }

  function addMsg(role, text) {
    const li = document.createElement('li');
    li.className = `msg msg-${role}`;
    li.textContent = text;
    el.transcript.appendChild(li);
    scrollTranscript();
    return li;
  }

  function addSystem(text) {
    const li = document.createElement('li');
    li.className = 'msg-system';
    li.textContent = text;
    el.transcript.appendChild(li);
    scrollTranscript();
  }

  function addTyping() {
    removeTyping();
    const li = document.createElement('li');
    li.className = 'msg msg-ai typing-wrap';
    li.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    li.style.padding = '0';
    el.transcript.appendChild(li);
    scrollTranscript();
  }
  function removeTyping() { $$('.typing-wrap', el.transcript).forEach((n) => n.remove()); }

  const execHasError = (exec) => exec.steps.some((s) => s.status === 'error');

  function shortResult(exec) {
    if (exec.workflow === 'callresults') return 'logged to Airtable';
    if (exec.workflow === 'transfer') return 'forwarded to Sam';
    if (exec.workflow === 'getslots') return exec.data.available ? 'available:true' : `busy · ${exec.data.days.reduce((n, d) => n + d.slots.length, 0)} open slots`;
    const r = exec.response?.results?.[0]?.result || '';
    return r.length > 44 ? `${r.slice(0, 44)}…` : r;
  }

  function addToolChip(exec) {
    const li = document.createElement('li');
    li.style.display = 'contents';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg msg-tool';
    btn.innerHTML = `<b>${esc(exec.tool)}</b><span>running…</span>`;
    btn.addEventListener('click', () => showExec(exec, false));
    li.appendChild(btn);
    el.transcript.appendChild(li);
    scrollTranscript();
    return btn;
  }
  function finalizeChip(btn, exec) {
    const err = execHasError(exec);
    btn.querySelector('span').outerHTML = `<span class="${err ? 'res-err' : 'res-ok'}">→ ${esc(shortResult(exec))}</span>`;
  }

  // ---------- Execution panel ----------
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const MS = { webhook: [1, 3], set: [1, 3], if: [0, 1], code: [3, 14], itemLists: [1, 2], gcal: [160, 420], airtable: [220, 520], respond: [1, 2] };

  function setExecStatus(state) {
    el.execStatus.dataset.state = state;
    el.execStatus.textContent = { idle: 'Idle', running: 'Running', success: 'Success', error: 'Handled error' }[state];
  }

  function renderPayload() {
    if (!shownExec) return;
    el.execPayload.innerHTML = highlight(payloadTab === 'request' ? { body: shownExec.request } : shownExec.response);
  }

  function renderHistory() {
    if (!execLog.length) { el.execHistory.innerHTML = '<li class="muted-xs">None yet</li>'; return; }
    el.execHistory.innerHTML = execLog.slice().reverse().map((e) => `<li><button type="button" class="hist${execHasError(e) ? ' err' : ''}" data-exec="${e.id}" aria-current="${e === shownExec}"><i></i>#${e.id} ${esc(e.tool)}</button></li>`).join('');
  }

  function finishNode(node, step) {
    node.classList.remove('active');
    node.classList.add(step.status === 'skip' ? 'skip' : 'done');
    if (step.status === 'error') node.classList.add('error');
    step.ms ??= rand(...MS[step.type]);
    node.querySelector('.ms').textContent = step.status === 'skip' ? 'not run' : `${step.ms}ms`;
  }

  async function showExec(exec, animate) {
    shownExec = exec;
    el.execWorkflow.textContent = exec.title;
    el.execPath.textContent = exec.workflow === 'transfer' ? exec.path : `POST ${exec.path}`;
    el.execSteps.innerHTML = exec.steps.map((s) => `
      <li class="node" data-type="${s.type}">
        <span class="node-dot">${TYPE_META[s.type].abbr}</span>
        <span class="node-main"><span class="node-name">${esc(s.node)}<span class="ms"></span></span><span class="node-detail">${esc(s.detail)}</span></span>
        ${s.branch ? `<span class="node-badge b-${s.branch}">${esc(s.branch)}</span>` : '<span></span>'}
      </li>`).join('');
    renderPayload();
    renderHistory();
    const nodes = $$('.node', el.execSteps);
    const final = execHasError(exec) ? 'error' : 'success';
    if (!animate) {
      nodes.forEach((n, i) => finishNode(n, exec.steps[i]));
      setExecStatus(final);
      return;
    }
    setExecStatus('running');
    el.execSteps.scrollTop = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (shownExec !== exec) return;
      const step = exec.steps[i];
      nodes[i].classList.add('active');
      el.execSteps.scrollTop = Math.max(0, nodes[i].offsetTop - el.execSteps.offsetTop - el.execSteps.clientHeight / 2);
      const slow = step.type === 'gcal' || step.type === 'airtable';
      await sleep(step.status === 'skip' ? 200 : slow ? 520 : 230);
      finishNode(nodes[i], step);
    }
    setExecStatus(final);
  }

  // ---------- Backend views ----------
  function renderCalendar() {
    const s = Store.get();
    const now = Date.now();
    const days = [];
    let d = Time.isWeekend(now) ? Time.nextBusinessDay(now) : Time.dayStart(now);
    while (days.length < 5) { if (!Time.isWeekend(d)) days.push(d); d = Time.addDays(d, 1); }
    const hours = BUSINESS.close - BUSINESS.open;
    const H = 44;
    const ids = new Set(s.events.map((e) => e.id));
    let html = `<div class="cal" style="--days:${days.length};--hours:${hours}"><div class="cal-head"></div>`;
    for (const day of days) {
      const [wd, md] = Time.dayShort(day).split(', ');
      html += `<div class="cal-head${Time.sameDay(day, now) ? ' today' : ''}">${wd}<b>${md}</b></div>`;
    }
    html += `<div class="cal-times" style="height:${hours * H}px">${Array.from({ length: hours - 1 }, (_, i) => {
      const h = BUSINESS.open + i + 1;
      return `<span style="top:${(i + 1) * H}px">${h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}</span>`;
    }).join('')}</div>`;
    for (const day of days) {
      const open = Time.at(day, BUSINESS.open);
      const close = Time.at(day, BUSINESS.close);
      html += `<div class="cal-col">`;
      for (const e of s.events.filter((ev) => ev.start < close && ev.end > open)) {
        const top = ((Math.max(e.start, open) - open) / 3600000) * H;
        const height = ((Math.min(e.end, close) - Math.max(e.start, open)) / 3600000) * H - 3;
        const flash = prevEventIds && !prevEventIds.has(e.id) ? ' flash' : '';
        html += `<div class="evt${e.source === 'ellie' ? ' ellie' : ''}${flash}" style="top:${top + 1}px;height:${height}px" title="${esc(e.summary)} · ${Time.time(e.start)}–${Time.time(e.end)}">
          <b>${esc(e.summary)}</b>${height > 30 ? `<span>${Time.time(e.start)}–${Time.time(e.end)}</span>` : ''}</div>`;
      }
      if (Time.sameDay(day, now) && now > open && now < close) html += `<div class="cal-now" style="top:${((now - open) / 3600000) * H}px"></div>`;
      html += '</div>';
    }
    html += '</div><p class="cal-note"><span><i style="background:#ff5a1f"></i>Booked by Ellie</span><span><i style="background:#5d626b"></i>Existing events</span><span>Times shown in America/Chicago · next 5 business days</span></p>';
    el.viewCalendar.innerHTML = html;
    prevEventIds = ids;
  }

  const fmtIso = (iso) => (iso ? `${Time.dayShort(Date.parse(iso))} · ${Time.time(Date.parse(iso))}` : '');

  function renderAppointments() {
    const rows = Store.get().appointments.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    el.countAppointments.textContent = rows.length;
    const keys = new Set(rows.map((r) => `${r.id}|${r['Booking Status']}|${r.starttime}`));
    if (!rows.length) {
      el.viewAppointments.innerHTML = '<div class="empty-table">No appointments yet. Book one with Ellie and the Airtable row will show up here.</div>';
    } else {
      el.viewAppointments.innerHTML = `<table class="at"><thead><tr>
        <th>Name</th><th>Email</th><th>Phone Number</th><th>Booking Status</th><th>starttime</th><th>endtime</th><th>meetlink</th><th>meetdescription</th><th>Voice Agent</th><th>eventId</th><th>CallRecordingId</th>
      </tr></thead><tbody>${rows.map((r) => {
        const k = `${r.id}|${r['Booking Status']}|${r.starttime}`;
        return `<tr class="${prevApptKeys && !prevApptKeys.has(k) ? 'flash' : ''}">
          <td>${esc(r.Name)}</td><td class="mono">${esc(r.Email)}</td><td class="mono">${esc(fmtPhone(r['Phone Number']))}</td>
          <td><span class="status status-${esc(r['Booking Status'])}">${esc(r['Booking Status'])}</span></td>
          <td class="mono">${esc(fmtIso(r.starttime))}</td><td class="mono">${esc(fmtIso(r.endtime))}</td>
          <td class="mono">${esc(r.meetlink.replace('https://', ''))}</td>
          <td><div class="clip">${esc(r.meetdescription)}</div></td><td>${esc(r['Voice Agent'].join(', '))}</td>
          <td class="mono">${esc(r.eventId.slice(0, 12))}…</td><td class="mono">${esc(r.CallRecordingId[0].slice(0, 13))}…</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    }
    prevApptKeys = keys;
  }

  function renderCalls() {
    const rows = Store.get().calls.slice().reverse();
    el.countCalls.textContent = rows.length;
    const ids = new Set(rows.map((r) => r.id));
    if (!rows.length) {
      el.viewCalls.innerHTML = '<div class="empty-table">No calls logged yet. Hang up a call to send the end-of-call report to n8n.</div>';
    } else {
      el.viewCalls.innerHTML = `<table class="at"><thead><tr>
        <th>callrecording_id</th><th>customer_Number</th><th>startedAt</th><th>Length</th><th>Cost</th><th>callsummary</th><th>transcript</th>
      </tr></thead><tbody>${rows.map((r) => `
        <tr class="${prevCallIds && !prevCallIds.has(r.id) ? 'flash' : ''}">
          <td class="mono">${esc(r.callrecording_id.slice(0, 13))}…</td><td class="mono">${esc(fmtPhone(r.customer_Number))}</td>
          <td class="mono">${esc(Time.stamp(Date.parse(r.startedAt)))}</td><td class="mono">${Math.floor(r.duration / 60)}m ${String(r.duration % 60).padStart(2, '0')}s</td>
          <td class="mono">$${Number(r.Cost).toFixed(3)}</td><td><div class="clip">${esc(r.callsummary)}</div></td>
          <td><details class="tx"><summary>View transcript</summary><pre>${esc(r.transcript)}</pre></details></td>
        </tr>`).join('')}</tbody></table>`;
    }
    prevCallIds = ids;
  }

  function renderAlgo() {
    const s = Store.get();
    const now = Date.now();
    const day = Time.nextBusinessDay(now);
    const avail = N8N.computeAvailability(s.events, now).find((d) => Time.sameDay(d.day, day));
    el.algoDay.textContent = Time.dayHuge(day);
    const cells = [];
    const slotCount = (BUSINESS.close - BUSINESS.open) * 2;
    for (let i = 0; i < slotCount; i++) {
      const t = Time.at(day, BUSINESS.open) + i * SLOT;
      let cls = 'algo-cell';
      if (N8N.busy(s.events, t, t + SLOT).length) cls += ' busy';
      else if (avail?.ranges.some(([a, b]) => t >= a && t <= b)) cls += ' wide';
      else if (avail?.slots.includes(t)) cls += ' free';
      const h = BUSINESS.open + i / 2;
      const label = i % 2 === 0 ? `<small>${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}</small>` : '';
      cells.push(`<div class="${cls}" title="${Time.time(t)}">${label}</div>`);
    }
    el.algoTrack.innerHTML = cells.join('');
    el.algoOutput.textContent = avail ? N8N.availabilityText([avail]) : `### ${Time.dayHuge(day)}\nAvailable Start Times: none`;
  }

  function renderBackend() {
    if (holdRender) return;
    el.callerNumber.textContent = fmtPhone(Store.get().callerNumber);
    renderCalendar();
    renderAppointments();
    renderCalls();
    renderAlgo();
  }
  Store.subscribe(() => renderBackend());

  // ---------- Controls ----------
  function refreshControls() {
    const busy = ellie.busy;
    const canType = callActive && !busy && !scenarioRunning;
    el.msgInput.disabled = !canType;
    el.sendBtn.disabled = !canType;
    el.micBtn.disabled = !Voice.supported.stt || !callActive || (busy && !listening) || scenarioRunning;
    el.msgInput.placeholder = !callActive ? 'Start a call to talk to Ellie…'
      : scenarioRunning ? 'Autoplaying a demo call…'
        : busy ? 'Ellie is talking…'
          : Voice.supported.stt ? 'Type a reply, or tap the mic' : 'Type your reply…';
    $$('.scen').forEach((b) => { b.disabled = scenarioRunning; });
    renderSuggestions();
  }

  function setCallUI(active) {
    el.callBtn.dataset.active = String(active);
    el.callBtn.querySelector('span').textContent = active ? 'End call' : 'Start call';
    el.callStatus.dataset.state = active ? 'live' : 'ended';
    el.callStatus.textContent = active ? 'Live' : 'Ended';
    if (!active) setOrb('idle');
    refreshControls();
  }

  function tick() {
    if (!call) return;
    const s = Math.floor((Date.now() - call.startedAt) / 1000);
    el.callTimer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function callerAppointment() {
    const s = Store.get();
    return s.appointments
      .filter((r) => r['Phone Number'] === s.callerNumber && r['Booking Status'] !== 'Canceled' && Date.parse(r.starttime) > Date.now())
      .sort((a, b) => Date.parse(a.starttime) - Date.parse(b.starttime))[0] || null;
  }

  function freeSlotAwayFrom(ms) {
    const days = N8N.computeAvailability(Store.get().events, Date.now());
    const all = days.flatMap((d) => d.slots);
    return all.find((t) => !Time.sameDay(t, ms) && Time.parts(t).h >= 10) || all[0] || null;
  }

  const spokenEmail = (email) => {
    const [local, domain] = email.split('@');
    return `${local.split('').map((c) => (c === '.' ? 'dot' : c)).join(' ')} at ${domain.replace(/\./g, ' dot ')}`;
  };

  function renderSuggestions() {
    if (!callActive || scenarioRunning || ellie.busy) { el.suggestions.innerHTML = ''; return; }
    const now = Date.now();
    const nb = Time.nextBusinessDay(now);
    const appt = callerAppointment();
    const apptPhrase = appt ? phraseFor(Date.parse(appt.starttime)) : 'tomorrow at 1:30 pm';
    const free = freeSlotAwayFrom(appt ? Date.parse(appt.starttime) : now);
    const map = {
      intent: ["My AC is blowing warm air, can someone come out?", "I'd like to reschedule my appointment", 'I need to cancel an appointment', 'What are your hours?', 'Hot Brisket'],
      name: ['My name is Maria Lopez', "It's Jordan Reyes"],
      email: ['m a r i a dot l o p e z at gmail dot com', 'jordan.reyes@outlook.com'],
      notes: ['My AC is blowing warm air', 'Annual furnace tune-up', 'Quote for a new heat pump'],
      time: ellie.ctx.intent === 'cancel' ? [apptPhrase] : [phraseFor(Time.at(nb, 15)), phraseFor(Time.at(Time.addDays(nb, 1), 10)), 'Saturday at noon', 'Yesterday at 2 pm'],
      prevTime: [apptPhrase],
      newTime: free ? [phraseFor(free)] : [],
      pickSlot: [...ellie.ctx.offered.map((t) => Time.time(t)), 'The first one works', 'None of those work'],
      offerReschedule: ["Yes, let's move it", 'No, just cancel it'],
      cancelNotes: ['Something came up at work', 'Already got it fixed'],
      anythingElse: ["No, that's all. Thanks!", 'What are your hours?', 'How much do estimates cost?'],
    };
    const items = map[ellie.awaiting] || [];
    el.suggestions.innerHTML = items.map((t) => `<button type="button" class="sugg">${esc(capFirst(t))}</button>`).join('');
  }

  // ---------- Ellie wiring ----------
  const ellie = createEllie({
    async say(text, speech) {
      if (!callActive) return;
      removeTyping();
      addMsg('ai', text);
      setOrb('speaking', 'Speaking…');
      await Voice.speak(speech);
      if (callActive) setOrb(ellie.busy ? 'thinking' : 'idle', ellie.busy ? 'Thinking…' : 'On the line');
    },
    async tool(fn) {
      holdRender = true;
      const exec = fn();
      exec.callId = call?.id;
      if (call) call.tools++;
      execLog.push(exec);
      removeTyping();
      const chip = addToolChip(exec);
      setOrb('thinking', `n8n ${exec.path.replace('/webhook', '')}…`);
      await showExec(exec, callActive);
      finalizeChip(chip, exec);
      holdRender = false;
      renderBackend();
      return exec;
    },
    async transfer() {
      const exec = {
        id: ++Store.get().executions, workflow: 'transfer', title: 'TransferCall (Vapi built-in)', tool: 'TransferCall', path: 'vapi · transferCall · no n8n webhook',
        request: { message: { type: 'tool-calls', toolCalls: [{ type: 'function', function: { name: 'transferCall', arguments: { destination: 'Sam (forwarding number)' } } }], call: { id: call.id, customer: { number: call.customer } } } },
        response: { status: 'forwarding', destination: 'Sam' },
        steps: [
          { node: 'Trigger matched', type: 'if', detail: 'emergency language or the phrase "Hot Brisket"', branch: 'true' },
          { node: 'TransferCall tool', type: 'webhook', detail: "Vapi dials Sam's forwarding number" },
          { node: 'Warm handoff', type: 'respond', detail: 'Ellie drops off the call' },
        ],
        data: {},
      };
      execLog.push(exec);
      const chip = addToolChip(exec);
      await showExec(exec, true);
      finalizeChip(chip, exec);
    },
    end: (reason) => endCall(reason),
    thinking(on) {
      if (on && callActive && el.orb.dataset.state !== 'speaking') setOrb('thinking', 'Thinking…');
      if (!on && callActive) {
        setOrb('idle', 'On the line');
        if (el.handsFree.checked && !scenarioRunning && !listening && Voice.supported.stt) setTimeout(() => { if (callActive && !ellie.busy) toggleMic(); }, 300);
      }
      refreshControls();
    },
    update: refreshControls,
  });

  async function startCall() {
    if (callActive || ending) return;
    Voice.stopSpeaking();
    callActive = true;
    const s = Store.get();
    call = { id: (crypto.randomUUID ? crypto.randomUUID() : Store.rid('call-', 24)), customer: s.callerNumber, startedAt: Date.now(), tools: 0 };
    el.transcript.innerHTML = '';
    el.callTimer.textContent = '00:00';
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    setCallUI(true);
    addSystem(`Call connected · ${Time.stamp(Date.now())} CT`);
    await ellie.start(call);
  }

  async function endCall(reason = 'completed') {
    if (!callActive || ending) return;
    ending = true;
    callActive = false;
    Voice.stopSpeaking();
    Voice.stopListening();
    setMic(false);
    clearInterval(timer);
    removeTyping();
    const endedAt = Date.now();
    const mins = Math.max((endedAt - call.startedAt) / 60000, 0.1);
    const report = {
      callId: call.id, customer: call.customer, startedAt: call.startedAt, endedAt,
      cost: +(mins * 0.13 + call.tools * 0.004 + 0.01).toFixed(3),
      summary: ellie.summary(), transcript: ellie.transcriptText(),
    };
    ellie.stop();
    setCallUI(false);
    addSystem(reason === 'transferred' ? 'Call transferred to Sam · end-of-call report sent to n8n' : 'Call ended · end-of-call report sent to n8n');
    holdRender = true;
    const exec = N8N.callResults(report);
    execLog.push(exec);
    const chip = addToolChip(exec);
    await showExec(exec, true);
    finalizeChip(chip, exec);
    holdRender = false;
    renderBackend();
    ending = false;
    refreshControls();
  }

  async function sendUser(text) {
    const t = text.trim();
    if (!t || !callActive || ellie.busy) return;
    addMsg('user', t);
    el.msgInput.value = '';
    addTyping();
    await ellie.handle(t);
  }

  function setMic(on) {
    listening = on;
    el.micBtn.dataset.listening = String(on);
    el.micBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Speak to Ellie');
  }

  function toggleMic() {
    if (listening) { Voice.stopListening(); setMic(false); if (callActive) setOrb('idle', 'On the line'); refreshControls(); return; }
    if (!callActive || ellie.busy || !Voice.supported.stt) return;
    Voice.stopSpeaking();
    setMic(true);
    setOrb('listening', 'Listening…');
    refreshControls();
    Voice.listen({
      onInterim: (t) => { el.msgInput.value = t; },
      onFinal: (t) => { el.msgInput.value = ''; sendUser(t); },
      onEnd: () => {
        setMic(false);
        if (callActive && !ellie.busy) setOrb('idle', 'On the line');
        refreshControls();
      },
      onError: (err) => {
        setMic(false);
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          el.handsFree.checked = false;
          toast('Microphone access is blocked. You can still type your replies.');
        } else if (err === 'no-speech') {
          toast("I didn't hear anything. Tap the mic and try again.");
        }
        refreshControls();
      },
    });
  }

  // ---------- Scenarios ----------
  async function typeAndSend(line) {
    el.msgInput.value = '';
    const step = Math.max(8, Math.min(26, 1100 / line.length));
    for (let i = 1; i <= line.length; i++) {
      if (!callActive) return;
      el.msgInput.value = line.slice(0, i);
      await sleep(step);
    }
    await sleep(250);
    await sendUser(line);
  }

  function buildScript(name) {
    const now = Date.now();
    const nb = Time.nextBusinessDay(now);
    if (name === 'book') {
      return {
        intent: "Hi! My AC is blowing warm air. Can someone come take a look?",
        name: "Sure, it's Maria Lopez.",
        email: 'm a r i a dot l o p e z at gmail dot com',
        notes: 'The AC is blowing warm air and the house is getting hot.',
        time: phraseFor(Time.at(nb, 15)),
        pickSlot: 'The first one works for me.',
        anythingElse: "No, that's all. Thanks, Ellie!",
      };
    }
    if (name === 'emergency') return { intent: 'I think I smell gas coming from my furnace!' };
    const appt = callerAppointment();
    if (!appt) return null;
    const start = Date.parse(appt.starttime);
    const base = { name: `It's ${appt.Name}.`, email: spokenEmail(appt.Email), anythingElse: "Nope, that's it. Thank you!" };
    if (name === 'reschedule') {
      const free = freeSlotAwayFrom(start);
      return { ...base, intent: 'Hi, I need to reschedule my appointment.', prevTime: phraseFor(start), newTime: free ? phraseFor(free) : 'friday at 11 am', pickSlot: 'The first one, please.' };
    }
    return { ...base, intent: 'Hey, I need to cancel an appointment.', time: phraseFor(start), offerReschedule: 'No, just cancel it please.', cancelNotes: 'Something came up at work, sorry.' };
  }

  async function runScenario(name) {
    if (scenarioRunning) return;
    const script = buildScript(name);
    if (!script) {
      toast('No upcoming booking from this caller yet. Run the "Book" call first.');
      return;
    }
    document.getElementById('demo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (callActive) await endCall('completed');
    scenarioRunning = true;
    refreshControls();
    try {
      await startCall();
      for (let turn = 0; turn < 16 && callActive; turn++) {
        await sleep(450);
        const line = script[ellie.awaiting];
        if (!line) break;
        await typeAndSend(line);
      }
    } finally {
      scenarioRunning = false;
      refreshControls();
    }
  }

  // ---------- Events ----------
  el.callBtn.addEventListener('click', () => (callActive ? endCall('completed') : startCall()));
  el.composer.addEventListener('submit', (e) => { e.preventDefault(); sendUser(el.msgInput.value); });
  el.micBtn.addEventListener('click', toggleMic);
  el.suggestions.addEventListener('click', (e) => {
    const b = e.target.closest('.sugg');
    if (b) sendUser(b.textContent);
  });
  el.voiceToggle.addEventListener('change', () => { Voice.enabled = el.voiceToggle.checked; });
  $$('.scen').forEach((b) => b.addEventListener('click', () => runScenario(b.dataset.scenario)));
  $$('[data-start-call]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('demo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!callActive && !scenarioRunning) setTimeout(startCall, 450);
  }));
  $$('.payload .tab').forEach((t) => t.addEventListener('click', () => {
    payloadTab = t.dataset.tab;
    $$('.payload .tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    renderPayload();
  }));
  $$('.backend .tab').forEach((t) => t.addEventListener('click', () => {
    $$('.backend .tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    el.viewCalendar.hidden = t.dataset.view !== 'calendar';
    el.viewAppointments.hidden = t.dataset.view !== 'appointments';
    el.viewCalls.hidden = t.dataset.view !== 'calls';
  }));
  el.execHistory.addEventListener('click', (e) => {
    const b = e.target.closest('[data-exec]');
    if (!b) return;
    const exec = execLog.find((x) => x.id === +b.dataset.exec);
    if (exec) showExec(exec, false);
  });
  el.copyPayload.addEventListener('click', async () => {
    if (!shownExec) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payloadTab === 'request' ? { body: shownExec.request } : shownExec.response, null, 2));
      toast('Payload copied');
    } catch { toast('Copy failed. Select the text manually.'); }
  });
  el.resetData.addEventListener('click', () => {
    if (callActive || scenarioRunning) { toast('End the call before resetting.'); return; }
    prevEventIds = prevApptKeys = prevCallIds = null;
    Store.reset();
    toast('Demo calendar and Airtable data reset');
  });
  window.addEventListener('scroll', () => el.nav.classList.toggle('scrolled', window.scrollY > 8), { passive: true });

  // ---------- Init ----------
  if (!Voice.supported.stt) { el.sttNote.hidden = false; el.handsFreeWrap.hidden = true; }
  if (!Voice.supported.tts) { el.voiceToggle.checked = false; el.voiceToggle.disabled = true; Voice.enabled = false; }
  renderWorkflowMap();
  renderBackend();
  refreshControls();
  setExecStatus('idle');
})();
