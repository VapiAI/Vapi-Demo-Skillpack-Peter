<!-- Bundled copy of the base /vapi-demo skill (Vapi-Demo-Builder v1.0.0).
     Reference material for vapi-demo-skillpack-peter, NOT a separate skill.
     Paths below like templates/ and examples/ are relative to this base/ folder.
     Where this file and ../SKILL.md disagree, ../SKILL.md wins. -->


# Vapi Demo Builder

Point at an existing assistant or squad and produce a deployed, Vapi-branded demo
dashboard for live calls. The demo is theater built on real signals: every panel
is driven by actual webhooks from the actual agent, paced so a room can read it.

**Hard scope limits.** This skill never creates, edits, or tests the AGENT — no
prompt work, no tool changes, no test calls against it. The only mutations ever
made to Vapi resources are demo wiring (the assistant's `server.url` +
`serverMessages`, and optionally detaching the assistant from a phone number for
assistant-request), each done only after the user explicitly approves it and with
the prior value recorded for rollback. Generated projects carry NO customer names
— sanitize before writing a line.

## Phase 0 — Cold start (you were given only an id)

**Enter here when the request is just an id** — "make me a demo for this
assistant id `<uuid>`" — with no env file, no key, no phone number, and no
Railway. That is the common case, and it is not a reason to open the full
intake interview. Run the steps below in order, starting with step 0. They
REPLACE Phase 0 Intake and Phase 1 Discovery; every other phase still applies
unchanged.

**0. Before anything else, confirm you can actually run here.** Try
`node --version`.

- **No shell tool at all, or code runs only in a hosted sandbox** — you are in
  Claude Desktop, claude.ai, or a similar hosted surface. **Stop and say so.**
  This skill needs a local machine. It writes a project folder, runs a server on
  a port, installs and logs into the Railway CLI, and deploys to a URL that Vapi
  can reach. A hosted sandbox is not the user's machine and has none of that,
  so there is nothing partial worth building. Tell the user this needs Claude
  Code on their own computer, and stop there. Do NOT start the intake, do not
  ask for an API key, and do not produce a dashboard file as a consolation
  prize — a page nobody can deploy or wire is worse than a clear no.
- **A shell that works** — continue to step 1.

Getting this wrong is expensive in one direction only. Stopping early costs a
sentence. Discovering it at deploy time costs the user their whole session and
their API key was pasted for nothing.

**1. Ask for one thing and nothing else: the org's PRIVATE API key.** Say where
it is (dashboard → Organization Settings → API Keys) and that the private key is
the one that works. Do not ask about squads, phone numbers, panels, or Railway
yet. You cannot resolve the id without the key, so this question comes first and
alone.

**2. Resolve the id yourself. Never ask "is that an assistant or a squad".**
The two id types are indistinguishable UUIDs, and users call both "the assistant
id". Probe, in this order:

    curl -s -o /dev/null -w '%{http_code}' https://api.vapi.ai/assistant/$ID \
      -H "Authorization: Bearer $KEY"     # 200 → assistant
    curl -s -o /dev/null -w '%{http_code}' https://api.vapi.ai/squad/$ID \
      -H "Authorization: Bearer $KEY"     # 200 → squad

Verified status codes (2026-08-19, live): the wrong type returns a clean **404**,
a bad key returns **401**, and a non-UUID returns **400** `id must be a valid
UUID`. Nothing returns 400 or 500 in a way that breaks the fallthrough, so treat
the codes literally:

| Outcome | What it means | What to do |
|---|---|---|
| assistant 200 | It is an assistant | Continue. Right panel = `report-panel.html` |
| assistant 404, squad 200 | It is a squad | Continue. Right panel = `squad-panel.html`, and EVERY member gets wired in Default path step 9 |
| both 404 | Wrong id, or the key belongs to a different org | Say both possibilities and stop. Do not guess |
| 401 | Wrong or public key | Ask again for the private key |
| 400 | Not a UUID | They pasted a name or a URL fragment. Ask for the id from the dashboard URL |

The 200 body carries `orgId` and `name`, so **this probe is also the credential
test** — print the agent name back to the user as confirmation before going on.
That one line catches a wrong-org key before it wastes a build.

**3. Write `demo.env` FOR them.** Do not hand over `templates/demo.env.example`
and ask them to fill it in. Create the project folder, write `demo.env` with the
key and the resolved `ASSISTANT_ID` or `SQUAD_ID`, write `.gitignore` containing
`demo.env` in the same step, and pull the configs into `configs/` as Phase 0
Intake describes. They gave you a key and an id, which is everything the file
needs so far.

**3a. If writing or reading `demo.env` is denied, do not fight it.** Many
setups deny `.env` access on purpose (`Read(./.env)`, `Read(./.env.*)`,
`Read(**/*.env)`, or a managed policy), and the deny can cover writes as well as
reads. **Never route around the guard** — no `cat` to dodge a blocked `Read`, no
renaming the file to slip past a glob. That is the user's security config doing
its job, and defeating it silently is worse than the inconvenience.

You do not need the file. You already have the key in context because the user
pasted it in step 1, and the deploy-time home for secrets is Railway variables,
not a file on disk. So when the file is blocked:

- Run the local server with the values inline for that one command rather than
  sourcing a file (`VAPI_API_KEY=... ASSISTANT_ID=... node server.mjs`).
- Put the real values in Railway with `railway variables --set` after the first
  `railway up`, exactly as the Default path already does. The deployed demo
  reads them from the environment and never wants the file.
- Skip `configs/` to disk if file writes are blocked too. Pull the assistant or
  squad config, read it in context for the Phase 3 audit, and tell the user you
  have no on-disk rollback record so they should keep the `assistant-before`
  JSON you print for them.

Say plainly which step was blocked and which of these you are doing instead.
Offer the two alternatives once, then proceed without waiting: the user can
create `demo.env` themselves from content you print, or they can relax the
matching permission rule. Neither is required to finish.

**4. Preflight, and heal what you can without them.** Run the Phase 0 preflight
checks. Install the missing pieces yourself rather than reporting them
(`npm i -g @railway/cli`, `brew install jq`, `npx playwright install chromium`).
Exactly one item ever goes back to the user, so make it a single clear ask:
`railway login` opens a browser and finishes there, so an agent cannot complete
it. Give them the command, wait, then confirm with `railway whoami`.

**5. Now ask the one question that has no default: how do calls reach the agent
during the demo?** An existing phone number (get the number and its id), or the
web-call button. If neither exists, say so and resolve it before building.

**6. Take the defaults for everything else and run the Default path.** On this
path do NOT run the Phase 1 discovery interview — a user who pasted an id and
nothing else has no basis to answer it, and it is what makes a first build stall.
Use the standard layout, the right panel chosen in step 2, no assistant-request
strip, and no web-call button unless step 5 selected it. Go straight through the
Default path to a deployed URL. Offer the optional pieces AFTER they have a live
board to look at, when the questions are concrete.

## Phase 0 — Intake (collect ALL of this before anything else)

**Given only an id and nothing else? Do Phase 0 Cold start above instead** — it
gathers the same things in an order a user with an empty machine can actually
answer. This section is the checklist of what must end up collected, and the
path to run when the user arrives with their setup already in hand.

One conversation, up front. A demo that stalls halfway because a key or a
phone number is missing wastes the exact person it was meant to impress.

**1. The env file.** Have the user fill `templates/demo.env.example` → save as
`demo.env` in the project folder, and add `demo.env` to `.gitignore` in the
same step. Load it with `set -a; source demo.env; set +a`. If that read or
write is denied by the user's permission rules, see Cold start step 3a — the
build finishes without the file, and you never route around the guard. The API key must be
the org's PRIVATE key — it is what makes you debuggable, not just buildable:

    # pull the full agent config (and each tool by id from model.toolIds)
    curl -s https://api.vapi.ai/assistant/$ASSISTANT_ID -H "Authorization: Bearer $VAPI_API_KEY"
    curl -s https://api.vapi.ai/tool/$TOOL_ID          -H "Authorization: Bearer $VAPI_API_KEY"
    # when a panel stays empty: read what the platform recorded for the call
    curl -s "https://api.vapi.ai/call?assistantId=$ASSISTANT_ID&limit=3" \
      -H "Authorization: Bearer $VAPI_API_KEY"

Pull the assistant (or squad + every member) and its tools FIRST and save them
to a `configs/` folder in the project. That snapshot is your rollback record, the
input to the compatibility audit (Phase 3), and your context when something
misbehaves mid-demo.

**2. Preflight the machine.** Run these; fix anything missing before building:

    node --version          # need 20+
    railway whoami          # see the note below — this one can block you
    jq --version            # used throughout
    curl --version
    npx playwright --version              # fetches the package on first run
    npx playwright install chromium       # idempotent; downloads the browser once
                            # Optional but STRONGLY recommended: lets the builder
                            # verify its own work by screenshot instead of asking
                            # the user to look. Works from any folder, no
                            # node_modules needed:
                            #   npx playwright screenshot --browser chromium \
                            #     --viewport-size 1440,760 http://localhost:7788 check.png
                            # Screenshot every state that matters (idle, mid-call
                            # via try-it.sh, ended, after reset) and LOOK at them.

**Railway is the one preflight item that can stall a build, so clear it first.**
`command not found` means the CLI is missing (`brew install railway`, or
`npm i -g @railway/cli`). `Unauthorized` means the user must run `railway login`
themselves — it opens a browser and finishes in a browser, so an agent cannot
complete it. Ask for it in the same message as the rest of the intake, never
after the demo is built. On a machine with no browser, `railway login
--browserless` prints a code to paste. Also settle now whether the deploy goes
to a NEW project (`railway init`) or an existing one (`railway link`), and that
the user accepts a real deployment being created on their account.

**3. How will calls reach the agent during the demo?** Decide now, not at the
end: an attached phone number (fill PHONE_NUMBER in the env), or the web-call
button (fill VAPI_ORG_ID and VAPI_PRIVATE_KEY; PUBLIC_ORIGIN after first
deploy — see the deploy-ordering note in step 8 of the Default path). If the
answer is "no number exists and no web calls", stop and resolve that with
the user.

**4. What the room should see.** Two questions that make the demo land:
which 2–3 moments of the call should the audience be able to SEE happening,
and what will the presenter actually say on the call? Panels built against
the presenter's real script always beat generic ones. Ask for brand font
files (optional; system fallback is fine).

## Default path (when in doubt, do exactly this)

Everything beyond this section is judgment. This section is not. Given nothing
but an assistant id and an API key, this produces a working deployed demo. The
local half (steps 2 to 7) has been run from an empty folder and screenshotted at
every state; the wiring half (steps 9 and 10) has carried a real production
call. Do them in order and do not skip the proofs — several steps exist because
skipping the proof produced a demo that looked finished and was not.

1. Complete Phase 0 (env file saved, preflight green, configs pulled) — via
   Cold start if the user gave you only an id, via Intake if they arrived
   prepared. Either way you reach this step knowing whether the target is an
   assistant or a squad, which decides the right panel in step 6.
2. `mkdir demo && cd demo && mkdir public`
3. Copy `templates/server-skeleton.mjs` → `server.mjs`, and
   `examples/demo-dashboard.html` → `public/index.html`.
4. Prove it runs before touching Vapi — and prove the thing answering is YOURS.
   Pick a port nothing is on, start the server so its output goes to a file you
   read, then confirm the boot line and the owner before believing anything:

       lsof -nP -i :7788 -sTCP:LISTEN        # busy? pick another and export PORT
       PORT=7788 node server.mjs > server.log 2>&1 &
       cat server.log                        # MUST say: demo server on :7788
       lsof -a -p $(lsof -nP -ti :7788 -sTCP:LISTEN) -d cwd -Fn | tail -1

   Then `bash examples/try-it.sh http://localhost:7788` — always pass the URL,
   because the script's default is 7788 and it reports nothing when it lands on
   a stranger. Every panel must move. If it does not, stop and fix that first.

   🔴 **A leftover server on the port fakes a perfect result.** The port is in
   use, your `node server.mjs` dies with EADDRINUSE into a log nobody reads,
   `/health` answers `{"ok":true}`, the page loads, the replay POSTs return
   200, and the screenshot shows a plausible call — all served by someone
   else's process. Caught exactly this way while rehearsing this skill. The
   boot line and the cwd check above are what make the proof real.
5. Make it yours. The example is a ride-booking demo; six strings carry that
   scenario, and a demo shown with any of them left over looks unfinished:
   `<title>`, the `<h1>` agent name, the `.num` phone number, the `Sarah`
   speaker label (two places, plus the assembly strip's persona fallback), the
   third panel's `<h2>`, and the `PLACEHOLDERS` icon for that panel. Search the
   file for `Sarah` and `ride` and leave neither behind.
6. Right panel default: replace the ride panel with `templates/squad-panel.html`
   if the target is a squad, otherwise `templates/report-panel.html` (a titled
   card that fills at hangup from `call.report`). Both are copy-paste edits that
   work for any agent. Do not invent a custom panel unless the user asked for
   one in discovery.
7. The assistant-request strip needs nothing from you unless the demo is
   showcasing caller recognition: it hides itself while idle and only appears
   once a call resolves through it. To remove the code entirely, deleting the
   `<div class="assembly idle" id="assembly">` block is enough — the strip's
   JavaScript is null-guarded and goes inert. If you do delete it, load the
   page and check the browser console is clean, because a dead listener here
   stops the whole script and the page then quietly never updates.

   If Cold start step 5 selected the web-call button (no phone number to
   dial), wire it in now rather than skipping it: paste
   `templates/webcall-button.html`'s markup + script into the page, and add
   `VAPI_ORG_ID`, `VAPI_PRIVATE_KEY`, `ASSISTANT_ID` to `demo.env` — the server
   skeleton's `/webcall-token` route already reads them. Leave `PUBLIC_ORIGIN`
   for step 8b; it doesn't exist yet. Skip the whole button if a phone number
   is what's being used instead — it's additive later either way.
8. Deploy. Order matters here, and three of these steps are easy to get wrong:

       # Railway detects Node from package.json. The skeleton has no deps, but
       # without this file there is no start command and the deploy is useless.
       cat > package.json <<'JSON'
       { "name": "vapi-demo", "private": true, "type": "module",
         "scripts": { "start": "node server.mjs" }, "engines": { "node": ">=20" } }
       JSON

       railway init --name <demo-name>        # or railway link for an existing project
       railway up --detach --service <demo-name>
       railway domain --service <demo-name>   # prints the public URL, or makes one
       railway variables --set "KEY=value" --service <demo-name>   # only works after a service exists
       curl <url>/health                      # until {"ok":true}; ~30s on a cold project

   `railway variables` before the first `railway up` fails with "Project has no
   services". Later deploys need `--service <name>` once the CLI reports the
   linked service as None. `railway domain` is what turns a running service into
   a URL you can hand to Vapi — and it has to run BEFORE the `variables --set`
   pass if the web-call button is in play: `PUBLIC_ORIGIN` is that same domain
   URL, so setting variables first just means a second pass to backfill it.
9. Wire the assistant — record the old value FIRST, then patch:

       curl -s https://api.vapi.ai/assistant/$ID -H "Authorization: Bearer $KEY" \
         | tee assistant-before.json | jq '{server, serverMessages}'

       curl -s -X PATCH https://api.vapi.ai/assistant/$ID \
         -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
         -d '{"server": {"url": "https://<your-app>.up.railway.app/vapi"},
              "serverMessages": ["status-update","transcript","conversation-update","end-of-call-report"]}'

   Rollback is PATCHing back the `server` and `serverMessages` from
   `assistant-before.json`. 🔴 Before this step, confirm every tool on the
   assistant has its OWN `server.url` (Phase 5 explains why).

   **Squad id instead of an assistant id?** `server` and `serverMessages`
   live on ASSISTANTS, never on the squad object. Resolve the members first:

       curl -s https://api.vapi.ai/squad/$SQUAD_ID -H "Authorization: Bearer $KEY" \
         | jq '[.members[] | {assistantId, hasInline: (.assistant != null)}]'

   Then run step 9 once per member `assistantId` (record each before-file).
   🔴 **Every member, without exception.** `server.url` and `serverMessages`
   are read off the ACTIVE assistant, not the call, so an unwired member takes
   over mid-call and the board goes dark exactly when the handoff happens.
   All members share one call id, so the one dashboard shows the whole call
   across handoffs with no extra work. Add `assistant.started` to
   `serverMessages` for squads, and use `templates/squad-panel.html` as the
   right panel: it lights up whichever member is talking. Members defined INLINE in the squad
   (no assistantId) must be wired by PATCHing the squad's own `members`
   array to add `server` + `serverMessages` inside each inline assistant —
   record the full squad JSON first.
10. Replay `try-it.sh` against the deployed `/vapi`, then dial the agent's real
    number and watch the board. If a panel stays empty, redeploy with
    `DEBUG_BODIES=1` set as a Railway variable and read the raw webhook bodies
    in the Railway logs.

🔴 **The web-call button connecting is NOT proof the demo is wired — verified
live, this reads as success and isn't.** Clicking "Talk to the agent" makes
the browser's Vapi Web SDK dial Vapi directly with the minted token; that
path has nothing to do with `assistant.server.url`. So the call connects and
audio works the moment step 7's button code exists — usually well before
step 9 ever runs — while the transcript, tool-call, and outcome panels stay
on their idle placeholders the entire call, because those are fed by the
SEPARATE webhook channel that only exists once the assistant is patched.
Treat the panels updating, not the call connecting, as the actual pass/fail
signal, and don't tell the user the demo is ready until you've watched at
least the transcript panel move on a real call after step 9.

**Testing locally before deploying?** Two independent gaps, not one:
- The dashboard's OWN webhook flow can be proven with `bash examples/try-it.sh
  http://localhost:<port>` — that script POSTs synthetic webhooks straight to
  your local `/vapi`, so it never needs Vapi to reach your machine at all.
  This is the right way to catch panel/rendering bugs cheaply before deploying.
- What it can NOT prove is the real assistant → webhook path, because Vapi's
  servers cannot reach `localhost`. A cloudflared quick tunnel works for
  WEBHOOK ingress (point the assistant's server.url at it) but does NOT stream
  SSE — the page loads and then nothing moves, with no error anywhere (verified
  live: 200 + correct headers, zero body bytes, padding did not help). Watch the
  dashboard on localhost while the tunnel carries webhooks. Railway streams SSE
  correctly once deployed. If the demo uses the web-call button, set
  `PUBLIC_ORIGIN=http://localhost:<port>` in `demo.env` before testing locally
  at all — otherwise `/webcall-token` 503s and the button looks dead with no
  on-screen error (only a console error naming the 503). Either way, the only
  way to prove the full path for real is deploy (step 8) + wire (step 9).

## Phase 1 — Discovery (before any code)

Ask one question at a time. The goal is to find the demo's MOMENTS — the 3–5
seconds where a Vapi feature becomes visible — then design panels around them.

**Skip this phase entirely on the Cold start path.** Take the defaults and get
them a deployed board first. These questions land once there is something on a
screen to react to.

1. **Which Vapi features is this demo selling?** (tool calling, caller
   recognition via assistant-request, live call control pushes, multilingual,
   structured outputs, transfers…) The answer decides which optional pieces get
   built. Push back on "all of them" — a demo that dramatizes two features beats
   one that gestures at six.
2. **What does the agent DO that changes over a call?** That's the right panel.
   Ride status, an order building up, a form filling in, an appointment slot
   locking, a verification checklist. If nothing accumulates, the right panel can
   show the end-of-call structured outputs landing instead.
3. **Who is watching, and on what screen?** Projector = bigger type, fewer
   panels, higher contrast. Screen share = denser is fine.
4. **How do calls reach the agent during the demo?** Phone number on the wall,
   presenter dials, or a web-call button on the page (see optional pieces).

**The standard layout is not a per-demo decision — start from it every time.**
A bounded shell (max 1380px, full viewport height) holding a card header and
three card panels that scroll internally, so the page itself never scrolls. The
header carries logo, a divider, the agent name, the number as a pill, then the
call id and a status pill pushed right, and Reset. Panels are numbered in
Gridnik (`01 · LIVE TRANSCRIPT`): **transcript left, tool calls middle, use-case
panel right**. The assistant-request strip sits between header and panels and
hides itself unless a call resolves through it. Only the RIGHT PANEL is a design
decision, so confirm its content with a quick sketch and leave the rest alone.

## Phase 2 — Prerequisites gate (all of it BEFORE building)

Batch every environment question here so nothing interrupts the build later.

- `railway whoami` — logged in? If not: `railway login`. Which workspace/project
  (new `railway init` vs existing `railway link`)?
- Node 20+ locally (`node --version`) — the skeleton is dependency-free ESM.
- A Vapi API key for the org that owns the agent, provided by the user. Store it
  ONLY in env vars / Railway variables, never in the repo.
- Which assistant/squad id, and does the user have edit rights on it?
- Brand fonts (Avantt, Foundry Gridnik) if available — the CSS falls back
  cleanly without them; never fetch fonts from a CDN at demo time.

## Phase 3 — Read the target and AUDIT it against the dashboard (read-only)

`GET /assistant/:id` (or squad + members) and every tool by id, into `configs/`
(Phase 0). Then read those configs AGAINST the dashboard code you are about to
ship, checking each row below. Ten minutes here prevents the worst demo
failure, which is discovering an incompatibility with the room watching.

| Config | Check against the dashboard |
|---|---|
| `transcriber.provider` | The webhook SHAPE is uniform (`role`, `transcript`, `transcriptType`) but `transcriptType` is a VERBATIM passthrough of whatever the provider's stream decided, with no normalization anywhere downstream. There are two incompatible FINAL semantics, and which one you get is the thing that matters: **multi-final and disjoint** (Deepgram nova family, Speechmatics) sends several finals per sentence, each carrying only its own fragment, so finals must be APPENDED; **single-final and whole-utterance** (Soniox, Deepgram Flux, AssemblyAI, Gladia, OpenAI) sends one final restating everything the partials showed, so appending it double-writes. Do not branch on the provider. Use the watermark algorithm in the demo-craft section, which satisfies both, and correct from `conversation-update` on top of it. |
| `model.tools` / `toolIds` | 🔴 Every SERVER-BACKED tool needs its OWN `server.url` before the assistant's server can be retargeted (Phase 5). Built-in types execute inside Vapi and never call out, so `voicemail`, `dtmf`, `endCall`, `transferCall`, and `handoff` showing no server.url is normal and not a blocker. The rule bites `function`, `apiRequest`, and MCP tools. Also eyeball arg schemas: the tool card prints args as `key: value` lines, so a tool that takes a 2KB blob argument needs the card's arg rendering trimmed. |
| `server.url` (current) | Non-empty means it is load-bearing (production assistant-request, tool fallback). Do NOT overwrite without the conflict conversation in Phase 5. |
| `serverMessages` (current) | If `phone-call-control` is present, the agent's hang-up is delegated to that server — never carry it into the demo wiring, and flag it to the user. |
| voice / languages | Multilingual agents render fine (text is text), but the speaker label in the example is a fixed name — rename it to this agent's persona. |
| `maxDurationSeconds` | Longer than the presenter's demo script? A call that dies mid-demo at a 60s cap looks like a crash. |
| `analysisPlan` / structured outputs | Whatever exists lands on `call.report`, keyed by structured-output id with its own `name` and `result`. This is exactly what `templates/report-panel.html` renders, so it decides how much the default right panel pays off. None configured is fine — the panel still shows the ended reason. |
| squad members | Run every row above per member; members share the one board. |
| squad handoff wiring | Before concluding a squad cannot hand off, look in `.members[].assistantOverrides["tools:append"]` — that is where a squad's `handoff` tool and its `destinations` usually live, NOT on the member assistant's own `model.tools`/`toolIds`. Checking only the assistant produces a confident, wrong "this squad has no handoff." A squad with genuinely no destinations anywhere will never leave member 1, so say so before building a panel that depends on the hop. |

## Phase 4 — Scaffold

Copy `templates/server-skeleton.mjs` (rename to `server.mjs`, add `public/`),
start the dashboard from `examples/demo-dashboard.html` — a complete, sanitized,
production-tested page carrying the default look above plus every behaviour the
demo-craft section argues for: idle placeholders, a reset that clears state, the
stale-event guard, the live-state fallback, the authoritative transcript
correction, tool cards, and the self-hiding assistant-request strip with manual
flatten/expand. Replace the ride-specific right panel with `squad-panel.html`,
`report-panel.html`, or your own. Keep the shell and header as they are.

The example is self-contained (logo and favicon are inlined) except for the
Avantt / Foundry Gridnik font files, which its `@font-face` blocks reference at
`/fonts/`. Supply the font files in `public/fonts/` if you have them; without
them the font stacks fall back to system fonts cleanly. Optional pieces:

- **Assistant-request strip** — only if the number can be detached from the
  assistant (that phone number then answers NOTHING without the demo server up;
  get explicit approval, record the prior `assistantId`).
- **Web-call button** — `templates/webcall-button.html` (client) + the
  `/webcall-token` block already in the skeleton (server). Needs VAPI_ORG_ID,
  VAPI_PRIVATE_KEY, ASSISTANT_ID, PUBLIC_ORIGIN in Railway variables.

## Phase 5 — Wiring rules (where demos break agents)

- **Observe tools via `conversation-update`, never by taking tool webhooks.**
  The messages array carries every tool call and result no matter whose server
  executes them. Verified live shape (2026-08-18): every update resends the
  FULL history; tool calls carry stable ids; tool RESULTS carry `name` and
  `result` but NO id, so results can only be paired to calls positionally per
  name — the skeleton does this. Models really do emit parallel same-name
  calls (observed: two `order_food` calls in one turn), so never assume one
  running card.
- 🔴 **Taking over `assistant.server.url` hijacks tools that lack their own
  `server.url`** — tool webhooks fall back to the assistant's server, the demo
  won't answer them, and those tools silently break. Check every attached tool
  has its own server.url before pointing the assistant at the demo. If the
  assistant's server.url is load-bearing (production `assistant-request`, tool
  fallback), DON'T retarget it — ask the user how they want events forwarded.
- `serverMessages` for a demo: `status-update`, `transcript`,
  `conversation-update`, `end-of-call-report`, plus `assistant.started` for a
  squad. Note `transcript` is NOT in Vapi's default set, so it must be listed
  explicitly. Never add `phone-call-control` (it delegates hang-up to your
  server — a behavior switch, not telemetry).
- **Which squad member is talking** is not something to infer. Every server
  message carries `message.assistant`, and that IS the currently active member,
  re-pointed on every hop; `assistant.started` announces each swap in
  `newAssistant`. Do not try to read it off handoff tool calls: `handoff` and
  `transferCall` are local tools and never produce a `tool-calls` webhook.
- Assistant-request answers have a **hard 7.5s end-to-end budget** (telephony
  ceiling, NOT `server.timeoutSeconds`); a late answer kills the call. Any
  `assistantOverrides.model` must include `provider` + `model`.

## Phase 6 — Deploy and verify THE DEMO (not the agent)

1. `railway up --detach`, set variables, `curl /health` until live.
2. **Byte-diff the deployed page against the local file** — Railway serves the
   last image, and "deployed = HEAD" is an assumption until checked.
3. **Synthetic webhook probes**: replay `examples/try-it.sh` against the
   deployed `/vapi` (or hand-craft bodies for the use-case panel) and watch the
   panels move. This exercises the whole demo with zero calls placed.
4. Screenshot the states that matter (idle, mid-call, ended, reset) and LOOK at
   them — DOM assertions pass while the screen shows empty cards.
5. A live-call rehearsal is out of scope here — dial the demo line yourself and
   watch the board. If you need automated call testing or agent-side changes,
   Noah R. has voice-agent building and call-testing skills that may help.

## Demo craft — what makes it land (hard-won)

- **Slow real steps down to legible speed; never invent steps.** The
  assistant-request resolution takes ~1.1s naturally — invisible. Holding the
  webhook to a ~3.5s DEADLINE (target total elapsed, never an unconditional
  sleep — a cold container's startup must eat the wait, not stack on it) makes
  four stages readable while spending half the budget. Every animated stage must
  map to work that actually happens, because someone in the room will ask.
- **Idle states everywhere.** Panels show titled placeholder cards before the
  first call — a blank dashboard on a projector reads as broken.
- **A reset button, and test it AFTER a call, not before.** Reset has to clear
  the STATE behind each panel, not just its markup. A panel blanked without its
  variables cleared looks reset until the next render restores the old view, so
  a presenter clears the board and one stale card stares back. Run a call, hit
  reset, and look at every panel.
- **Auto-collapse is a presenting decision — give a manual toggle.** The strip
  that folded itself away on call-connect got rebuilt as flatten/expand by hand.
- **Animations settle, never vanish.** Chips that fly out of a panel leave it
  empty for the rest of the call; push toward the target and return.
- **Verify each edit landed, not that "something changed".** A scripted
  multi-part edit whose only check is "the file differs" will happily apply
  four of five replacements and report success, and the missing one is found
  later by a person watching a demo. Grep for a string unique to EVERY part.
  This exact failure shipped a squad panel whose state flag was set by code
  that nothing rendered.
- **Instrument the timeline instead of screenshotting a moment.** Sampling the
  DOM every 250ms through a whole call and printing only the transitions
  answers "was the right thing lit at the right time" in one run. Screenshots
  keep landing on the wrong instant, and a page that connects mid-call replays
  the buffer instantly, collapsing every intermediate state into the final one.
- **Never let one event own a visual state.** A single lost `status-update`
  left a deployed board reading "Ringing" for an entire call while the
  transcript scrolled underneath it. Any content event proves the call is live,
  so derive the live state from transcripts and tool calls too, and treat the
  status event as a hint rather than the source of truth. The same applies to
  anything else a demo asserts once and then never re-checks.
- **Guard against stale events.** A finished call's end-of-call report arrives
  seconds after hangup — on a quick redial it lands INSIDE the next call and, if
  the page resets on any unfamiliar callId, wipes the live board. Only a
  call-opening event may claim the view (`callScopeAccept` in the example).
- **Use the watermark model for the live transcript, not prefix matching.**
  Track a `finalTextLength` per bubble: a PARTIAL replaces everything after the
  watermark, a FINAL appends and advances it. That one algorithm handles
  cumulative partials, disjoint finals, whole-utterance finals, and mid-turn
  revisions without knowing which transcriber is attached. It is what Vapi's own
  dashboard does (`apps/dashboard/src/features/globalCall/utils/transcriptAccumulator.ts`).
  Prefix and growth heuristics look equivalent and are not: they encode one
  vendor's habits, and a provider that revises a word mid-utterance produces two
  bubbles for one sentence. Two edges the watermark still does not cover, worth
  deciding explicitly: the `transcript` message carries no turn id, so
  consecutive turns from one speaker collapse into a single bubble; and Deepgram
  Flux can emit a second final for a turn (a timeout-driven synthetic
  end-of-turn followed by the real one), which appends the turn twice unless a
  final whose text is a superset of the just-finalized text replaces instead of
  appends.
- **Stream the transcript, but correct it from `conversation-update`.** Speech
  to text does not only append, it REVISES: "this is Sam calling for" becomes
  "this is Sam calling from Uber Eats", and one changed word defeats every
  prefix-based match, so the panel keeps both and the room sees the same
  sentence twice. Continuation fragments ("date.") and re-cut caller lines
  ("No. I do" then "Uh, no. I did not.") do the same. No matching heuristic
  fixes this reliably. The same `conversation-update` you already subscribe to
  carries the platform's OWN merged history, one message per turn with the
  speaking member named, so rewrite the settled turns from it at every turn
  boundary and re-append whatever is still being spoken. Live for immediacy,
  authoritative for truth: fragments appear for about a second and then heal.
  One honest limit: the LIVE `conversation-update` does not merge consecutive
  same-speaker user finals (only consecutive bot messages are merged; full
  merging happens in the end-of-call artifact). So on a multi-final provider a
  single spoken sentence can settle as several caller bubbles. The correction
  fixes revision duplicates, not fragment counts, which is the other reason to
  get the live watermark model right rather than lean on the correction alone.
- **Transcript partials/finals also reorder in transit** — reconcile by content,
  not arrival order (renderer in the example handles duplicates, late partials,
  and growth-merge).
- **Read the call record before blaming the dashboard.** `GET /call/:id` returns
  the merged `messages`. If a wrong word is in there too it is a speech-to-text
  problem to fix on the agent (add the term to the transcriber's keyterms), and
  if the record is clean but the screen is not, the bug is yours.
- **Testing trap:** a mocked clock advances JS timers but NOT CSS animations —
  content assertions pass while everything sits at opacity 0. Keep one test on a
  real clock reading `getComputedStyle(...).opacity`, and review screenshots.
- `prefers-reduced-motion`: state changes carry the meaning; motion is garnish.

## Files in this skill

- `examples/demo-dashboard.html` — the full worked example (ride-booking
  scenario), every pattern above implemented and demo-proven. It pairs with the
  server skeleton out of the box: copy both into a folder, `node server.mjs`,
  then `bash examples/try-it.sh` replays a scripted call through every panel —
  no Vapi account, no phone call.
- `examples/try-it.sh` — that scripted call, paced like a real conversation;
  also the template for probing any generated demo before dialing.
- `templates/server-skeleton.mjs` — dependency-free observer server: SSE with
  boot-token resume, webhook ingest, tool observation, optional
  assistant-request + web-call token blocks.
- `templates/squad-panel.html` — the right panel for a squad demo: every member
  listed, the one speaking lit up, handoffs marked. Includes the server half
  (roster fetch plus active-member detection). Use this whenever the target is
  a squad; use the report panel otherwise.
- `templates/report-panel.html` — the default right panel: a "Call outcome"
  card filled from the end-of-call report. Four copy-paste edits, no use-case
  knowledge needed. The example's own right panel is ride-specific; this is
  what replaces it.
- `templates/webcall-button.html` — the client half of the web-call button.
- `templates/demo.env.example` — the Phase 0 intake file; everything the
  builder needs from the user, with the why for each value.
