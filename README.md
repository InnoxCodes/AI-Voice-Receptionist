# Ellie — AI Voice Receptionist

An AI voice receptionist for **Harrison Climate Solutions**, a fictional HVAC
company, built on **Vapi** for the phone/voice layer and **n8n** for automation,
with **Google Calendar** as the source of truth for scheduling and **Airtable**
for logging every booking and call.

This repo is a **browser-based showcase** of that system: a faithful, in-browser
recreation of the n8n workflow, the Vapi tool contract, and Ellie's conversation
logic — so the whole project can be explored, demoed and read end-to-end without
a live phone line, a running n8n instance, or real Google/Airtable credentials.

**[Live demo](https://ellie-voice-receptionist.vercel.app)** · built by [Daksh Tyagi](https://github.com/InnoxCodes)

## What it does

Call Ellie (by typing or talking) and she will:

- Answer questions about hours, pricing and services
- **Book** a new HVAC appointment — gathering a name, a spelled-out email, the
  issue, and a time, checking availability first
- **Reschedule** an existing appointment by phone number lookup
- **Cancel** an appointment (offering to reschedule instead first)
- **Transfer** the call for emergencies or the secret phrase "Hot Brisket"

Every tool call she makes runs a node-by-node simulation of the real n8n
workflow — the same node names, branches and payload shapes as the exported
workflow JSON — against a simulated Google Calendar and Airtable base that
lives in `localStorage`.

## How it's built

| Layer | Real system | This repo |
|---|---|---|
| Voice agent | Vapi (STT → LLM → TTS) | `js/agent.js` + Web Speech API (`js/voice.js`) |
| Automation | n8n (5 webhooks, 55 nodes) | `js/n8n.js` — same node names & branches |
| Calendar | Google Calendar | Simulated in `js/store.js` |
| Database | Airtable | Simulated in `js/store.js` |
| NLU | Vapi's LLM | `js/parser.js` — rule-based intent/date/email parsing |

No build step, no dependencies — open `index.html` or serve the folder statically.

```bash
python3 -m http.server 4330
```

## Project structure

```
index.html          Landing page + live demo markup
styles.css           All styling (light landing page, dark demo console)
js/time.js           America/Chicago timezone helpers
js/store.js           localStorage-backed calendar/Airtable simulation
js/n8n.js             The 5 n8n workflows, node-by-node
js/parser.js          Natural language parsing (dates, emails, names, intent)
js/voice.js           Web Speech API wrapper (TTS + STT)
js/agent.js           Ellie's conversation logic and call flows
js/app.js             UI wiring — phone console, exec trace, backend views
```

## Background

This started as a real voice receptionist built with Vapi + n8n for an HVAC
business, automating appointment booking end-to-end over the phone. This repo
turns that workflow into something anyone can try in a browser, with the full
n8n automation visualized live as it runs.
