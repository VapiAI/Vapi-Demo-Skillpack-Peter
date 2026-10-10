---
name: vapi-demo-skillpack-peter
description: Peter's complete Vapi demo builder — the base /vapi-demo skill is bundled inside (base/BASE.md + templates), plus Peter's learnings on top. Use whenever Peter builds a Vapi demo — "make a demo for this assistant", "make an agent that does this", "add it to the railway page", "demo dashboard", "name the domain …". Covers creating the assistant first when asked (vapi-demo refuses to), Peter's org/Railway/folder defaults, custom Railway domain naming, web-call as the default, showing the last REAL call instead of try-it.sh dummy data, and a script that applies all default dashboard edits in one verified pass. Where this conflicts with the bundled base, this wins.
---

# Vapi Demo Skillpack (Peter)

Self-contained: the base `/vapi-demo` skill is **bundled in this plugin** at
`${CLAUDE_PLUGIN_ROOT}/skills/vapi-demo-skillpack-peter/base/` — read
`base/BASE.md` first and follow its phases (cold start, wiring, deploy,
demo craft), using the templates in `base/templates/` and `base/examples/`.
The separate vapi-demo plugin is no longer required. This file adds what was
learned building demos for Peter. **Where this file and BASE.md disagree,
this file wins** — these are Peter's explicit corrections.

## 0. Defaults (don't ask, just use)

- **Vapi org + key: ALWAYS ask Peter at the start of every build** for the
  org id AND that org's private API key, in one question, before any Vapi call
  (demos go into different orgs per customer). Do not fall back to a key in
  memory or a previous build. Verify with `GET /assistant?limit=1` (or any
  list) that the key works and that `orgId` on the response matches the id he
  gave; if it doesn't match, say so and stop. Never ask "assistant or squad".
  Never hardcode the key in this plugin, in project files, or in git — only in
  Railway variables and inline per command.
- **Agent changes: ask "just this agent, or the agent AND the skill?"**
  Whenever Peter asks to change an agent's behavior or settings (prompt rules,
  transcriber, voice, speaking plans, silence handling, tools…), ask once,
  before applying, whether it should go on **just this agent** or on **this
  agent and the skill** (so every future agent gets it: SKILL.md guidance,
  templates, defaults). Apply it to the agent either way; only edit + push the
  skill when he says both. Dashboard/page changes are not agent changes —
  those keep going into the skill by default.
- **Project folder:** `~/Desktop/Vapi Demos/<demo-name>/` (never `Claude Apps`).
- **Railway workspace:** `"Vapi Demos"` (personal trial is expired).
- **How calls reach the agent:** the web-call button, unless Peter gives a
  phone number. Don't stall on this question.
- **Browser tab title: ALWAYS "<Customer> x Vapi: Voice AI Demo"** (e.g.
  "eMoneyUSA x Vapi: Voice AI Demo"). Pass `--customer "<Customer>"` using the
  customer's own brand spelling; the script builds the title. Only without a
  customer does it fall back to "Vapi Voice AI Demo". Don't pass `--title`
  unless Peter asks for something else.
- **Right panel: ALWAYS "Agent prompt"** — the assistant's first message and
  system prompt, read live from Vapi (`GET /agent-prompt`). Peter asked for
  this in place of the "Call outcome" report panel, which only ever showed
  "Ended: customer ended call". Never use `report-panel.html` or the ride
  panel. For a squad, ask whether he wants the squad panel or per-member prompts.
- **Tool calls render INLINE in the transcript**, as a compact card
  ("Tool call · <name>", args, running→done, result) exactly where they
  happened between speech bubbles — live and when rebuilt from history
  (server `historyTurns()` keeps tool calls in order, results paired per name).
  There is NO separate tool-calls panel any more. A history update with no
  speech must never rebuild (wipe) the transcript.
- **Panel 03 is "Live call data"**, re-rendered every second: Status,
  Duration (ticking; Vapi's startedAt/endedAt when known), Turns (total +
  caller/assistant), Cost ($, 4 dp), Cost per hour (cost ÷ duration,
  "$5.73/hr"), Tokens (total + in/out), Tool calls,
  Call ID, Ended reason. Cost/tokens come from `GET /call-stats?id=` →
  `GET /call/:id` (`cost`, `costBreakdown.llmPromptTokens/llmCompletionTokens`),
  1s server cache, polling stops once an ended call has its final cost.
  Vapi only publishes cost/tokens AFTER the call ends (verified live), so
  they read "—" mid-call and fill in at hangup — expected, not a bug.
- **Middle column: ALWAYS "Config setup" on top + "Live call data"
  below** (config sizes to content, live data takes the rest). Config setup shows one compact row each for LLM,
  Transcriber, and Voice, read live from the assistant via the same
  `/agent-prompt` route. **The Voice row shows the voice by NAME and
  description, like the Vapi dashboard picker** ("Clementine - Hospitable
  Host" / "Warm with a friendly cadence…"), resolved server-side from
  `GET /voice-library/<provider>?limit=1000&page=N` matching `providerId`
  (cached per voice id). A raw voice id alone is not acceptable to Peter; it
  is only the fallback when the lookup finds nothing.
  Below Voice, a small-text **Stop speaking plan** line: "Words 0 · Voice
  0.2s · Back off 1s" from `assistant.stopSpeakingPlan` (numWords,
  voiceSeconds, backoffSeconds). When unset, show Vapi's dashboard defaults
  (0 / 0.2s / 1s) and append "· defaults" — never leave it blank.
  Under it, a **Start speaking plan** line in the exact same format: "Wait
  0.4s · Smart endpointing off · Punctuation 0.1s · No punctuation 1.5s ·
  Number 0.5s" from `assistant.startSpeakingPlan` (waitSeconds,
  smartEndpointingPlan.provider, transcriptionEndpointingPlan.*), with the
  same Vapi defaults + "· defaults" when unset. Config setup sizes to its
  content (never scrolls); Tool calls takes the remaining height (min 120px). Peter asked to
  keep tool calls, just smaller and under the config. Layout: 01 Live
  transcript · 02 Config setup / 03 Tool calls · 04 Agent prompt.

- **Live transcript: ALWAYS turn by turn.** One bubble per speaker turn —
  every fragment, partial and whole-utterance final from the same speaker
  merges into the current bubble (the stock renderer split one greeting into
  six bubbles: "Thanks for calling…Our" / "our t" / "is out of the office…").
  Conversation-update history is merged the same way. A small centred marker
  sits between turns: "Assistant turn ended · Caller turn started". Test it
  locally with `scripts/try-fragments.sh http://localhost:<port>` (replays
  that exact fragmented greeting) — never against the deployed URL.

- **Web addresses read as written, not as spoken.** The transcript shows
  "dot com" as ".com" (also .net/.org/.io/.ai/.co/.us/.gov/.edu), display-only.
  ALWAYS pass the customer's domain with `--domain <domain>` (repeatable) so
  spelled-out speech like "e money u s a dot com" displays as "emoneyusa.com".

- **In-line 2nd page "Simulations & Test"** (renamed from "Advanced"; tabs: Live | Simulations & Test | Logs | Monitoring & Structured Outputs | Tools & Knowledge Base)
  showing Simulations, Evaluations and **Structured outputs** for this agent
  (Peter trimmed the latency/cost/analysis cards — don't add them back
  unasked). Structured outputs = every `/structured-output` whose
  `assistantIds` includes ASSISTANT_ID (name, type, schema type/fields), each
  with the value from the latest call's `artifact.structuredOutputs[<id>]`.
  When Peter asks to create them: POST `/structured-output` with
  `assistantIds: [<id>]` AND PATCH the assistant's
  `artifactPlan.structuredOutputIds` (that is what actually triggers
  extraction after each call; save the prior artifactPlan first). Default set
  for a self-service agent: `call_reason` (enum string),
  `directed_to_self_service` (bool), `needs_human_follow_up` (bool),
  `caller_callback` (object: name, callback_number — only if volunteered).
  Spec lives in `<project>/configs/structured-outputs-spec.json`. Server route
  `GET /advanced` aggregates Vapi's Simulations API (`/eval/simulation`,
  `/scenario`, `/personality`, `/suite`, `/run` + `/run/{id}/item`) and Evals
  (`/eval`, `/eval/run`), filtered to suites/runs targeting ASSISTANT_ID,
  cached 15s; the page refreshes every 30s while the tab is open.
- **3rd in-line tab "Logs"** (tabs: Live | Advanced | Logs): call log for
  this agent, newest first, from `GET /logs` (→ `/call?assistantId=…&limit=25`,
  cached 10s): time, type chip (web/inbound), duration, ended reason, turns ·
  tools, cost, first caller line, structured-output chips. Click a row →
  `GET /logs?id=<callId>` → turn-by-turn transcript with inline tool calls
  (same `historyTurns()` + `displayText()` as the live board). Refreshes
  every 30s while open.
- **"Monitoring & Structured Outputs" tab + webhook DB** (Peter's ask):
  structured outputs card (moved off Simulations & Test), this agent's Vapi
  monitors + issues (`GET /monitoring/monitor`, `/monitoring/issue` — not in
  the public API spec but live), and **Stored webhooks** from a Postgres table
  `webhook_events` (id, received_at, source 'end-of-call-report'|'monitor',
  event_type, call_id, assistant_id, is_simulation, payload jsonb). Every
  end-of-call report on `/vapi` is stored (simulations flagged); monitor
  notifiers post to `POST /webhooks/monitor?token=<WEBHOOK_TOKEN>` (401
  without it). Setup per demo:
      railway add --database postgres
      railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
                        --set "WEBHOOK_TOKEN=$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
  `monitoring_patch.py` (run by apply-defaults) adds the tab, the routes and
  `pg` to package.json; add `node_modules/` to `.railwayignore`. Without
  DATABASE_URL nothing is stored and nothing breaks. Vapi monitors themselves
  (Monitoring → Monitors) are created in the dashboard: Effectiveness type =
  a true/false question; threshold "result is True ≥ N calls in window" →
  severity + notifiers (point a webhook notifier at the URL above).
- **4th in-line tab "Tools & Knowledge Base"** (tabs: Live | Advanced | Logs |
  Tools & Knowledge Base). Peter's ask: show the tools ACTIVE on the agent,
  not just tools that happen to be used on a live call. `GET /tools-kb` reads
  the assistant live (saved `model.toolIds` + inline `model.tools`, built-ins
  like endCall included), cached 30s. **Tools card:** counts (active /
  knowledge bases / built-in), then one row per tool with an "● Active" dot,
  type chip (Knowledge base / Function / Built-in…), description, parameter
  chips (required ones outlined), KB it searches, and usage ("Used 3× in the
  last 25 calls · last …" or "Ready on every call · not used…", counted from
  real calls only); click a row for full parameter docs, server, destinations.
  **Knowledge base card:** each query tool's KB with document count, indexed
  size, ready count, and one row per file (`GET /file/:id`) with size + READY.
  Snippets `tools-kb.{server,page}.js` + `tools-kb.css`, applied by
  `apply-defaults.py`. Refreshes every 30s while open; a failed load keeps the
  last good render and retries.
- **Tool calls in the live transcript = event-log entries** (Peter's ask, styled
  after Vapi's internal call log): "+mm:ss.mmm" call time (from the message's
  `secondsFromStart`), "Tool call · <name>", TOOL chip, args as key: value
  lines, then a second timestamped "Tool result" line with a RESULT chip and
  latency from Vapi's own timestamps; long results clamp (click to expand).
  `scripts/tool_log_patch.py` (run by apply-defaults, or alone on an existing
  demo) applies `snippets/tool-log.*`.
- **Knowledge lookups: don't make the caller wait in silence.** Vapi's `query`
  (Google KB) tool took 5.7 s + 4.7 s of LLM time before speech on the Jacuzzi
  demo (~10 s dead air). Peter's pattern instead: a FUNCTION tool on the demo
  server that answers instantly `{status:"lookup_started"}`; the agent says
  "let me pull up the manual" and asks ONE clarifying question; the server
  searches and pushes the result into the call with the call's
  `monitor.controlUrl` → `POST {type:"add-message", message:{role:"system",
  content:"[Background lookup result] …"}, triggerResponseEnabled:false}`
  (requires assistant `monitorPlan.controlEnabled: true`). Emit
  `tool.background` to the dashboard (rendered as "Background result · ADDED
  TO CALL"); history rebuilds it from system messages with that prefix.
  **Search only the caller's specific manual** (make `model` a required arg,
  map model → manual, plus the small FAQ) — Peter's explicit ask for speed.
  Section-level BM25 (split on headings, weight heading matches, exact
  "(Code NN)" match, down-weight table-of-contents chunks) answered in <1 ms.
  Export `localKnowledgeBase()` from the search module so the Tools &
  Knowledge Base tab lists the server-hosted documents. Start from
  `scripts/snippets/background-lookup.template.mjs` (fill its CONFIG: tool
  name, model→manual regexes, FAQ pattern; docs as .txt in `data/kb/`; its
  header lists the server + Vapi wiring). Prompt section that worked: "call
  it with query + model; it returns lookup_started; say you're pulling up the
  manual and ask ONE clarifying question (error code? when did it start?
  filter cleaned? pump running? / dealers: what have you checked?); never
  give steps before the [Background lookup result] arrives; answer only from
  it; don't re-search the same question".
- **Start the lookup while the caller is still talking, not at the turn**
  (Peter's ask). The LLM only runs at end of turn, so the demo server watches
  the caller's live `transcript` webhooks (partials too, real AND simulation
  calls — run it before the test-call drop) and, once the words so far name a
  model AND a symptom/code, searches that manual and add-messages the result
  into the call mid-sentence (`prefetchFromTranscript` in the template; spoken
  numbers → digits; dedupe per manual+issue; ignore a code at the very end of
  a still-growing partial — "code six" → "sixteen"; later results say they
  SUPERSEDE earlier ones). Prompt: "FIRST check for a [Background lookup
  result] and answer from it; call the tool only when none covers it". Codes:
  look up the code's definition line in that manual, then search the
  troubleshooting sections by its MEANING ("water flow is low" → "15.1 Flow
  issues"), not the caller's words. Jacuzzi result: lookup in the call at
  9.4 s while the caller spoke until 15.5 s; no tool round-trip; model
  latency 1.26 s → 0.43 s; scenario passed.
  **nova-3 sends the caller's speech in separate pieces** ("…j 300
  collection" / "spa showing heat low flow" / "code 16."), unlike Flux which
  resends the whole turn — so build the caller's turn from its finals (+ the
  live partial), reset when the agent speaks, and remember the model for the
  whole call; matching one webhook at a time silently never fires. Pre-fetch
  runs for simulation calls too but must NOT publish to the live board (pass
  no emitter when `isTestCall`). Simulation calls are identified by
  `type: "vapi.websocketCall"` + `metadata.isSimulation: "true"`
  (`metadata.role: "target"`, simulationRunId…); they also carry an
  `assistantOverrides` snapshot (model/voice/firstMessage) of the agent.
  Model names arrive mangled ("J-thirty 3" for J-335): glue the digits after
  the model letter and map by SERIES digit (J-3xx → J-300 manual), not the
  exact model number.
- **Endpointing: default to Deepgram `nova-3` with NO smart endpointing**
  (Peter's call). Flux turn detection (`flux-general-en`, eotThreshold 0.75)
  stopped mid-sentence cut-offs but added 0.4–0.6 s to EVERY reply (reply gap
  1.6–2.0 s); with the manual pre-fetched mid-sentence, an early endpoint no
  longer triggers a slow lookup, so speed wins. Other fixes that stay: lookup
  tool `async: true` (no 1.2 s wait on "lookup_started"); "one short sentence
  + ONE question, no recap" in the prompt.
- **Red "End call" button next to Talk to the agent** (Peter's ask), shown
  whenever a call is live on the board. A web call started from the page hangs
  up in the browser; any other live call of this agent (phone, another tab)
  is ended by `POST /end-call {callId}` → the call's `monitor.controlUrl`
  `{type:"end-call"}` (needs `monitorPlan.controlEnabled: true`; only this
  agent's calls). The talk button reads "● On call" meanwhile.
  `scripts/end_call_patch.py` (run by apply-defaults; works for phone demos too).
- **Calls must end on silence** (Peter's ask). Every agent gets:
  `silenceTimeoutSeconds: 15`, `messagePlan: {idleMessages: ["Are you still
  there?"], idleMessageMaxSpokenCount: 1, idleTimeoutSeconds: 8}`, an
  `endCallMessage`, the built-in `endCall` tool, and the prompt rule "use
  endCall after an unanswered 'are you still there?'". (Default 30 s left
  silent callers hanging; the earlier calls ended on silence-timed-out.)
- **Call viewer speaker lanes come from the AUDIO.** Transcript message
  durations can end seconds early (a caller still talking for 4 s after their
  message "ended" showed as silence). `/call-detail` reads the stereo recording
  (`artifact.presignedStereoUrl`; left = caller, right = assistant), 50 ms RMS
  windows, pauses under 0.7 s merged, cached per call, skipped over ~60 MB →
  falls back to transcript timings. Transcript text is unchanged.
- **Open tabs pick up deploys by themselves:** static files are served with
  `cache-control: no-cache`, and the SSE stream sends the server's boot id
  (`server.version`) on connect, so a tab that reconnects after a deploy
  reloads. Before this, an open tab kept showing the old dashboard.
- **Endpointing timings: keep Vapi's defaults** (Peter, agent + skill):
  `startSpeakingPlan: {waitSeconds: 0, transcriptionEndpointingPlan:
  {onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 1.5, onNumberSeconds:
  0.5}}`. NEVER set all three to 0 with smart endpointing off: endpointing
  dropped to ~10 ms and the agent answered half-sentences ("I'm calling about
  the J" → "Is it the J-three hundred collection?"), 3 interruptions in one
  call. Wait 0 is fine on its own.
- **Call viewer tool lane:** one marker per lookup — repeats of the same tool
  within ~8 s (pre-fetch refined from "heat" to "code 16") show once, when it
  first fired; never "×2". Each marker has its own label; a label that would
  overlap the previous one drops to a second row; labels in the last quarter
  anchor leftwards.
- **Vapi tool PATCH drops fields you don't send.** `PATCH /tool/:id
  {"async":true}` wiped `server`, so the call went to the assistant webhook and
  the lookup never ran (the agent then answered "per the manual" ungrounded).
  Always PATCH the full definition (type-specific fields + `server`), then GET
  and check `server.url`.
- **`.railwayignore` patterns match at any depth.** `kb/` also excluded
  `data/kb/`, the server crashed on boot (ENOENT) and the site went down.
  Anchor root-only folders with a slash (`/kb/`), and make data loaders
  tolerate a missing folder instead of throwing at import.
- **Never use the class name `adv-click` (or other ad-like class names).**
  Ad-blocker filter lists hide `.adv-click` with `display:none` — on Peter's
  Chrome every clickable row (Advanced rows, tool rows) rendered as zero
  height while the page looked fine in a clean browser. The clickable-row
  class is `row-click`; `apply-defaults.py` fails if `adv-click` appears. When
  a section shows on one machine but not another, test the class in the real
  browser: `getComputedStyle(el).display` is `none` with no matching page
  rule → an extension stylesheet.
- **Simulations card starts with "Simulator Settings"** (no description line; Peter's ask): the AI
  caller's voice name · provider · version + description, read from the latest
  tester-side call (`metadata.role: "tester"`; built-in personalities set no
  voice — Vapi used "Elliot · Vapi · v2"). Below it, **"Agent settings"**: the
  Config setup panel's data condensed to text lines (LLM, Transcriber, Voice,
  Stop speaking, Start speaking — same format), so a simulation reviewer sees
  the exact agent setup next to the results.
  **Tester personality chips are clickable**: clicking one expands its
  behavior (the personality's system prompt, `assistant.model.messages`),
  with its model and "built-in"; click again to collapse.
  **Each simulation's "Tester personality" is a dropdown** (expanded row):
  picking one → `POST /advanced/personality {simulationId, personalityId}` →
  `PATCH /eval/simulation/{id} {personalityId, name: "<scenario> · <persona>"}`
  (only simulations in this agent's suites); the next run uses it. Choppy simulation audio was NOT the
  voice: ~0.5 s digital-zero holes appeared only in some runs (22:13+ while
  several simulations overlapped); 10–30 ms frame drops occur in every
  simulation, never on real web calls — a Vapi simulation-transport issue to
  report, not a demo bug. Measure dropouts per channel from the stereo WAV
  (runs of exact-zero samples between loud audio).
- **Advanced tab rows RUN on click** (Peter: "when I click them, run the
  simulation or evaluation"). Row title → `POST /advanced/run {kind:
  simulation|suite|eval, id}`; "▶ Run all" runs the whole suite; the ▸ caret
  expands details (AI-caller instructions + pass checks / scripted turns +
  judge criterion). Simulations run as **VOICE** by default
  (`transport: {provider: 'vapi.websocket'}`, never webchat). **Evaluations
  run ONLY through the Evals API; simulations ONLY through the Simulations
  API — never mix them** (Peter's correction; an earlier rule turned evals
  into voice simulations in a "· evaluations" suite — don't). `seed-tests.py`
  creates evals with `POST /eval` (`chat.mockConversation` + LLM-judge) and
  the card runs them with `POST /eval/run`, showing definitions from
  `GET /eval` and runs from `GET /eval/run` (PASS/FAIL, eval viewer). Legacy
  "· evaluations" simulation suites are hidden. Evals are text chats with no
  live call, so any background-lookup tool must answer synchronously when
  there is no `call.id` (the template does). Each card lists only its own runs. Server only accepts ids in this
  agent's suite / org evals, 60s cooldown per item, 20 runs/hour (the page is
  public). Row button is ONLY "▶ Run", or "■ Stop" while that simulation is
  running (Peter: no PASS·view / status pills on the rows). Stop →
  `POST /advanced/stop {runId, itemId}` → `PATCH /eval/simulation/run/{id}`
  (or `/item/{itemId}`), only for runs targeting this agent. Evals show
  "Running…" instead (Vapi has no eval-run cancel). PASS/FAIL and "View" live
  ONLY under Recent runs. Polling every 5s while anything is active.
- **Live board, last call and Logs show REAL calls only.** Simulation runs
  call the same assistant (its server.url), so their webhooks would land on
  the live board. `isTestCall()` flags `metadata.isSimulation:"true"` /
  `simulationRunId` / type `vapi.websocketCall`; the /vapi handler drops
  those webhooks, and /last-call + /logs skip them (fetch 50–100, keep real).
  Evals are chat mocks and never create calls. Test calls stay viewable from
  the Advanced tab's call viewer.
- **Call viewer (Vapi-dashboard style)** opens automatically when a run
  started from the page finishes, and from any PASS/FAIL pill or "▶ View":
  header (date + TZ, type, call id copy, agent id, ended reason, duration,
  cost), lanes Assistant % / User % / Silence % / Tool calls from message
  `secondsFromStart` + `duration`, playhead synced to audio, 1x/1.5x/2x,
  click-to-seek, ⬇ Audio, clickable transcript. Audio via `GET /recording?id=`
  → 302 to Vapi `/call/{id}/mono-recording` signed URL (HIPAA bucket URLs are
  not public). Evals open the same frame with the scripted conversation +
  judge verdict (`GET /eval-run-detail?id=`).
- **Simulations must sound like normal calls — fewer curveballs** (Peter: the
  built-ins made it "fake and weird"). Built-in personalities are caricatures
  (Multitasking Maya stages "sorry, one sec… someone's at my door"; Rambling
  Roger rambles) and a task that hands over every detail makes the caller
  recite name + company + callback in the first breath. So, for every demo:
  - **Custom personalities** in the spec's `"personalities"` (prefix
    `Natural · `), each ONE mild trait in 2–3 sentences (Prepared pro, Unsure
    homeowner, Worried caller, In a hurry). `seed-tests.py` appends
    `NATURAL_BASE` (short turns, open with hello + reason in one sentence,
    details only when asked, no stage directions/distractions, react
    naturally, wrap up and end the call, and keep it a QUICK back-and-forth:
    most caller turns under ~10 words, 4–5+ short exchanges, take multi-step
    answers one piece at a time) and creates/updates them by name.
  - **Scenario instructions = SITUATION / GOAL / DETAILS (only if asked)**,
    never a script of lines to say.
  - Normal scenarios (the everyday calls the customer gets), not edge-case
    stunts. Re-running `seed-tests.py` PATCHes existing scenarios and switches
    each scenario's existing simulation to the new personality (no duplicates).
  Result on Jacuzzi: "Hey, I've got a 2025 J-three hundred spa showing heat
  low flow code 16." … "Okay, I'll give that a shot." instead of a recited
  monologue with fake interruptions.
- **Set up a simulation suite + evals for every demo agent**: write
  `<project>/configs/tests-spec.json` (4 scenarios, each paired with a
  natural custom tester personality (see above; built-ins only if asked) and 2–3 boolean pass checks; 3 chat evals with
  an LLM-judge criterion — cover the core happy path, a self-service
  redirect, PII refusal, a hardship/escalation path, and hours) and run
  `VAPI_API_KEY=... python3 scripts/seed-tests.py <spec> <assistantId> <out>`.
  **Every simulation is capped at 1 minute** (Peter's ask): `seed-tests.py`
  sets each scenario's `targetOverrides.maxDurationSeconds: 60` (spec
  `maxDurationSeconds`; re-running PATCHes existing scenarios), so Vapi ends
  the simulated call itself. The Simulations API has no max-turns field; don't
  cap by turns or end calls from the demo server.
  It only CREATES definitions (idempotent by name); never start a simulation
  or eval run without asking — runs cost money and place AI test calls.
  Python urllib needs a User-Agent header or Cloudflare returns 403 / 1010.

## 0b. Customer logo + Salesforce record (every demo)

The header ALWAYS shows the customer's logo to the LEFT of the agent label
(Vapi wordmark │ customer logo + agent label). Before building:

1. **Ask Peter which Salesforce Account this demo belongs to** (name or Id) —
   don't guess. Name searches mislead: "emoney" matched *eMoney Advisor*
   (emoneyadvisor.com), a different company from eMoneyUSA. Confirm with
   `SELECT Id, Name, Website, Type, Owner.Name FROM Account WHERE Id = '…'`
   (Salesforce MCP only — never ZoomInfo).
2. **Get the logo from the account's Website** (or the customer site Peter
   names): fetch the homepage, find the header/navbar `<img>` whose src or alt
   says logo (prefer the full-color/dark-on-light SVG, not the white footer
   one), download it into `<project>/brand/customer-logo.svg` (add `brand/`
   to `.railwayignore`), and confirm it's a real image with no
   `<script>` / `on*=` handlers.
3. Pass it to the script: `--logo "<project>/brand/customer-logo.svg"`. It's
   inlined as a data URI (page stays self-contained), 22px tall, max 160px
   wide, and the label is `white-space: nowrap` so the header doesn't wrap.
4. If no account exists or no logo can be found, say so and ask Peter for a
   logo file rather than shipping without one.

## 1. "Make an agent that does this" — create it first

vapi-demo refuses to create or prompt agents. When Peter asks for an agent,
build it before the dashboard:

1. If "this" isn't attached/described, ask for it — nothing else.
2. **Research the customer's real facts** before writing: fetch their website
   and its `/faq` (WebFetch). Fill phone numbers, hours, portal/apply URLs,
   button labels, funding timing, state notices from the source — and list what
   the site does NOT say (eligibility, documents, fraud line) so the prompt
   tells the agent not to guess.
3. Prompt structure that worked: Identity + goals in order → explicit "you
   cannot look up accounts / transfer / take payments" → voice style → Key facts
   → numbered call types → "when the team is next available" rules → Rules
   (never collect SSN/account/card/DOB; no promises of approval, rates, amounts,
   funding dates; no advice; 911 for safety) → Ending the call.
4. **Current time in the caller's zone** without any tool, via Vapi liquid:
   `{{"now" | date: "%A, %B %d, %Y at %I:%M %p", "America/Chicago"}}`, plus
   rules mapping day/time → next opening. It can't know holidays; tell it to
   say "the next business day".
5. **"No tool calls, no integrations" still means add the built-in `endCall`**
   (`model.tools: [{"type":"endCall"}]`) — Peter asked for it explicitly. It
   calls nothing external. Without it the agent can't hang up and calls end on
   `silence-timed-out`. Tell the prompt when to use it.
6. **Write brand names and URLs for the voice**: first message "e Money U S A",
   URLs as "e money u s a dot com". **Every caller-facing mention in the
   prompt must use the spoken form** — mixing in the written form
   ("go to emoneyusa.com") makes the model improvise ("e money uesa dot com").
   Keep the written domain only in one reference line, plus an explicit rule:
   'ALWAYS write the website exactly as "e money u s a dot com" … never
   "emoneyusa.com", never say "period".' Speech stays "dot com"; only the
   DASHBOARD shows ".com" (display-only, see `--domain`).
   **Add a "# Pronunciation" section** for every brand name / domain the agent
   says: one canonical written form used in all replies (e.g. "e-money U-S-A
   dot com"), a phonetic line ("EE-muh-nee  YOO - ESS - AY  dot  KOM"), what
   each part must NOT sound like ("eh-money", "uesa", "period"), and "never
   write the raw spelling in a reply". Use the same form in `firstMessage`.
   Peter's exact ask for eMoneyUSA: "e-money USA dot com".
   **Don't prioritize names; lead with the relevant information** (Peter's
   ask). The model wrote "No problem. Sam. Next." and the voice said "Sam"
   oddly. Every prompt: skip thanks/name-checks ("Thanks, Sam"); answer, give
   the next step or ask the one needed question; use the name only when needed
   (e.g. confirming it for a case), inside a sentence with a comma; no
   one-word sentences ("Next." / "No.").
   **One step per turn** (Peter, agent + skill): every prompt that walks a
   caller through steps says "ONE step per turn, about 25 words max, then
   wait for the caller; split multi-part steps; never read a whole procedure
   in one turn". A 56-word / 19 s answer ate a third of a 1-minute simulation
   and killed the back-and-forth. A prompt rule alone wasn't enough (still 59
   words): put it FIRST in "# Voice style" as "MOST IMPORTANT", and end every
   injected lookup result with "Reply rule: give only the NEXT single step
   (~25 words), then wait" (the template does). Result: agent turns ≤28 words,
   8 short caller turns in 60 s.
   **Don't repeat things back** (Peter, agent + skill): every prompt says no
   recaps, no echoing the caller's words, no "just to confirm" of what they
   already said; go straight to the answer / next step / one question. Also
   don't put caller details in example lines (an example "pull up the manual
   for your J three thirty-five" taught the model to repeat the model number).
   Only exception: read a callback number back once before creating a case.
   **The agent may have been edited in the Vapi dashboard**: before patching
   a prompt, GET the live assistant and build on it (check `updatedAt`); if it
   differs from the local copy, ask before overwriting.
7. Defaults that worked: OpenAI `gpt-4.1`, Deepgram `nova-3`, Cartesia
   `sonic-3.5` voice reused from an existing assistant in the org.
8. Build the body with python `json.dumps` from a prompt file (no shell
   escaping of the liquid braces), POST `/assistant`, then confirm `orgId`,
   `tools`, and that no `[` placeholders remain in the prompt.

## 2. Scaffold + default edits in ONE verified pass

After base Default path step 3 — copy `base/templates/server-skeleton.mjs` → `server.mjs` and
`base/examples/demo-dashboard.html` → `public/index.html` (and `base/examples/try-it.sh`) —
run:

    python3 "${CLAUDE_PLUGIN_ROOT}/skills/vapi-demo-skillpack-peter/scripts/apply-defaults.py" \
      "<project_dir>" --brand "<header agent label>" --customer "<Customer>" \
      --logo "<project_dir>/brand/customer-logo.svg" --domain <customer-domain.com>
    # add --phone "+1 (555) 123-4567" to keep a phone pill instead of the web-call button

It applies the rebrand (title, header label, Sarah → Assistant), the
"Agent prompt" right panel (`/agent-prompt` route + loader; it is excluded
from call resets because it describes the agent, not the call) with ride
cleanup, the split middle column (Config setup over a smaller Tool calls), the web-call button (markup, script, style), and the `/last-call`
route + page loader (section 4) — then greps a
marker for every part and fails loudly on anything missing. It was diffed
byte-for-byte against a deployed, working demo. Also add `.railwayignore`
(`configs/`, `*.log`, `demo.env`) and the `package.json` from vapi-demo step 8.

Project files stay generic (vapi-demo's no-customer-names rule) — the customer
name appears only at runtime via the agent, and in the domain if Peter names it.

## 3. Railway: deploy + domain naming

Order that works (vapi-demo step 8 is slightly different here):

    railway init --name <demo-name> --workspace "Vapi Demos"
    railway up --detach                       # first up creates the service; its id is in the build-logs URL
    railway service link <service-id>
    railway domain                            # generates <name>-production.up.railway.app
    railway domain status <domain-id>         # prints the URL
    railway variables --set VAPI_ORG_ID=... --set VAPI_PRIVATE_KEY=... --set VAPI_API_KEY=... \
                      --set ASSISTANT_ID=... --set PUBLIC_ORIGIN=https://<final-domain>

**Ask Peter for the domain name up front** (convention he used:
`<customer>-vapi-voiceai-demo.up.railway.app`). If it's renamed later:

    railway domain update <domain-id> --domain <new-name>.up.railway.app

**Verify a deploy against what changed.** Waiting for the served page to
byte-match `public/index.html` only proves a PAGE change landed — after a
server-only change the old container already matches, so probe a route whose
response changed (poll until the new behaviour shows) before declaring it live.

A rename REPLACES the old host (it 404s afterwards), so in the same step:
re-set `PUBLIC_ORIGIN` to the new origin (redeploys; decode a `/webcall-token`
JWT and check `allowedOrigins`), and PATCH the assistant's `server.url` to
`https://<new>/vapi`. Missing either breaks the button or the panels silently.

Wiring the assistant: if its `server.url` was null (fresh assistant), Peter's
"add it to the page" is the approval; still save `configs/assistant-before.json`.

## 4. Never leave dummy data on a deployed board

`try-it.sh` events go into the server's in-memory replay buffer and are
replayed to EVERY page that opens afterwards. Peter saw the ride-booking
dummy transcript on his live demo and asked for it gone. Rules:

- Run `try-it.sh` against **localhost only**. If you must probe the deployed
  `/vapi`, redeploy (`railway up --detach`) afterwards to clear the buffer.
- The board should show the **last real call** when opened: `/last-call`
  (added by the script) fetches `GET /call?assistantId=…&limit=1` with
  `VAPI_API_KEY` and the page renders its transcript and tool calls with the
  header reading "Last call <id>". A new live call takes over the
  board as usual. Test it locally by pointing `ASSISTANT_ID` at an assistant
  that already has calls.
- The fetch takes 1–2s: screenshot twice before concluding it's broken.

## 5. Verification notes

- Playwright's chromium is often not installed; use the built-in browser pane
  (`preview_start` with the URL) for screenshots instead of installing.
- Pass/fail is the panels moving on a real call, not the web call connecting.
- After the first real call, read its transcript (`/last-call` or
  `GET /call/:id`) and flag agent issues to Peter — e.g. timing promises
  ("funds as soon as today"), mispronounced URLs, `silence-timed-out` instead of
  `endCall`. Offer prompt fixes; don't silently change the agent.
- Don't try to persist secrets to other files on disk (auto mode blocks it,
  rightly). Memory + Railway variables are enough.
