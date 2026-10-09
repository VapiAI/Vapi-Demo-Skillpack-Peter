# Vapi-Demo-Skillpack-Peter

Self-contained Vapi demo builder: bundles the base `/vapi-demo` skill
(`skills/vapi-demo-skillpack-peter/base/` — BASE.md, templates, examples) plus
Peter's demo-building learnings and a script that applies every default
dashboard edit in one verified pass.

## Install

```
claude plugin marketplace add peter-eames-vapi/Vapi-Demo-Skillpack-Peter
claude plugin install vapi-demo-skillpack-peter@vapi-demo-skillpack-peter-marketplace
```

## What's inside

- `skills/vapi-demo-skillpack-peter/base/` — bundled base vapi-demo skill
  (reference doc + server skeleton, example dashboard, panel templates).
- `skills/vapi-demo-skillpack-peter/SKILL.md` — the rules (override base): defaults, agent
  creation, Railway deploy + domain naming, dashboard layout, pronunciation.
- `scripts/apply-defaults.py` — turns a fresh vapi-demo scaffold into the
  standard dashboard (logo, title, config/prompt panels, turn-by-turn
  transcript, inline tool calls, live call data, Advanced + Logs tabs) and
  fails loudly if any edit didn't land.
- `scripts/snippets/` — the JS/CSS those edits inject.
- `scripts/seed-tests.py` — creates a Vapi simulation suite + chat evals from a
  spec file (definitions only; never starts a run).
- `scripts/try-fragments.sh` — local replay of a fragmented greeting.

No API keys live in this repo; keys go in Railway variables only.
