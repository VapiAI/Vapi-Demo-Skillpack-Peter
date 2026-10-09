#!/usr/bin/env python3
"""Create a Vapi simulation suite + chat evals for one assistant from a spec file.

Definitions only: this never STARTS a simulation run or eval run (those cost
money and place AI test calls). Re-running is safe: anything whose name
already exists in the org is reused, not duplicated.

Spec (JSON):
{
  "suiteName": "...",
  "judgeModel": {"provider": "openai", "model": "gpt-4.1"},          # optional
  "scenarios": [
    {"name": "...", "instructions": "what the AI caller does/says",
     "personality": "Confused Carl",                                  # a built-in tester personality
     "checks": [{"name": "snake_case_name", "description": "true if ..."}]}  # boolean, must be true
  ],
  "evals": [
    {"name": "...", "description": "...",
     "turns": ["user message", ...],                                  # user lines; the agent replies after the last
     "judge": "PASS only if the assistant's last reply ..."}           # LLM-as-judge criterion
  ],
  "evalMode": "voice",            # default. Vapi evals are chat-only, so in voice mode each
                                  # eval becomes a VOICE simulation: an AI caller says the
                                  # scripted line(s) and the spoken reply is scored against
                                  # `judge`. Suite: "<suiteName> · evaluations". "chat" = old behaviour.
  "evalPersonality": "Decisive Derek"   # built-in tester that follows the script plainly
}

Usage:
  VAPI_API_KEY=... python3 seed-tests.py <spec.json> <assistantId> [out.json]
"""
import json
import os
import sys
import urllib.request

API = 'https://api.vapi.ai'
KEY = os.environ.get('VAPI_API_KEY') or sys.exit('set VAPI_API_KEY')


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
                                          'User-Agent': 'vapi-demo-skillpack/1.0'})  # Cloudflare 1010s urllib's default UA
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path} -> {e.code}: {e.read().decode()[:500]}')


def listing(path):
    j = call('GET', path + '?limit=100')
    return j if isinstance(j, list) else (j or {}).get('results', [])


def main():
    spec = json.load(open(sys.argv[1]))
    aid = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None
    judge_model = spec.get('judgeModel', {'provider': 'openai', 'model': 'gpt-4.1'})

    personalities = {p['name']: p['id'] for p in listing('/eval/simulation/personality')}
    scenarios = {s['name']: s['id'] for s in listing('/eval/simulation/scenario')}
    simulations = {s.get('name'): s['id'] for s in listing('/eval/simulation')}
    suites = {s['name']: s['id'] for s in listing('/eval/simulation/suite')}
    evals = {e.get('name'): e['id'] for e in listing('/eval')}
    created = {'scenarios': [], 'simulations': [], 'suite': None, 'evals': []}

    sim_ids = []
    for sc in spec['scenarios']:
        if sc['name'] in scenarios:
            sid = scenarios[sc['name']]
        else:
            sid = call('POST', '/eval/simulation/scenario', {
                'name': sc['name'],
                'instructions': sc['instructions'],
                'evaluations': [{
                    'structuredOutput': {'name': c['name'], 'type': 'ai',
                                         'schema': {'type': 'boolean', 'description': c['description']}},
                    'comparator': '=', 'value': True, 'required': True,
                } for c in sc['checks']],
            })['id']
            created['scenarios'].append(sc['name'])
        pname = sc.get('personality')
        if pname and pname not in personalities:
            sys.exit(f'unknown personality {pname!r}; available: {sorted(personalities)}')
        sim_name = sc['name'] + (f' · {pname}' if pname else '')
        if sim_name in simulations:
            sim_ids.append(simulations[sim_name])
        else:
            body = {'name': sim_name, 'scenarioId': sid}
            if pname:
                body['personalityId'] = personalities[pname]
            sim_ids.append(call('POST', '/eval/simulation', body)['id'])
            created['simulations'].append(sim_name)

    if spec['suiteName'] in suites:
        suite_id = suites[spec['suiteName']]
        call('PATCH', f'/eval/simulation/suite/{suite_id}', {
            'simulationIds': sim_ids,
            'targetAssignments': [{'targetType': 'assistant', 'targetId': aid}]})
    else:
        suite_id = call('POST', '/eval/simulation/suite', {
            'name': spec['suiteName'], 'simulationIds': sim_ids,
            'targetAssignments': [{'targetType': 'assistant', 'targetId': aid}]})['id']
        created['suite'] = spec['suiteName']

    eval_ids = []
    eval_suite_id = None
    if spec.get('evalMode', 'voice') == 'voice' and spec.get('evals'):
        epers = spec.get('evalPersonality', 'Decisive Derek')
        if epers not in personalities:
            sys.exit(f'unknown evalPersonality {epers!r}; available: {sorted(personalities)}')
        esim_ids = []
        for ev in spec['evals']:
            sname = 'Eval · ' + ev['name']
            lines = ' Then, after the agent answers, say exactly: '.join(f'"{t}"' for t in ev['turns'])
            instructions = (f'You are a caller running a quick check. After the agent greets you, say exactly: {lines}. '
                            'Do not add anything else or change the wording. Listen to the full answer, say '
                            '"Okay, thank you, goodbye," and end the call.')
            crit = ev['judge'].replace("the assistant's last reply", "the agent's reply to the scripted question")
            if sname in scenarios:
                sid = scenarios[sname]
            else:
                sid = call('POST', '/eval/simulation/scenario', {
                    'name': sname, 'instructions': instructions,
                    'evaluations': [{'structuredOutput': {'name': 'passes_' + ''.join(ch if ch.isalnum() else '_' for ch in ev['name'].lower()).strip('_')[:31],  # Vapi caps output names at 40 chars
                                                          'type': 'ai', 'schema': {'type': 'boolean', 'description': 'True only if: ' + crit}},
                                     'comparator': '=', 'value': True, 'required': True}],
                })['id']
                created['scenarios'].append(sname)
            if sname in simulations:
                esim_ids.append(simulations[sname])
            else:
                esim_ids.append(call('POST', '/eval/simulation', {'name': sname, 'scenarioId': sid, 'personalityId': personalities[epers]})['id'])
                created['simulations'].append(sname)
        ename = spec['suiteName'] + ' · evaluations'
        body = {'simulationIds': esim_ids, 'targetAssignments': [{'targetType': 'assistant', 'targetId': aid}]}
        if ename in suites:
            eval_suite_id = suites[ename]
            call('PATCH', f'/eval/simulation/suite/{eval_suite_id}', body)
        else:
            eval_suite_id = call('POST', '/eval/simulation/suite', {'name': ename, **body})['id']
            created['evalSuite'] = ename
    for ev in (spec.get('evals', []) if spec.get('evalMode', 'voice') == 'chat' else []):
        if ev['name'] in evals:
            eval_ids.append(evals[ev['name']])
            continue
        msgs = [{'role': 'user', 'content': t} for t in ev['turns']]
        msgs.append({'role': 'assistant', 'judgePlan': {'type': 'ai', 'model': {
            **judge_model,
            'messages': [{'role': 'system', 'content':
                'You are grading a phone agent. Conversation so far:\n{{messages}}\n\n'
                'Criterion: ' + ev['judge'] + '\n\nRespond with exactly one word: pass or fail.'}]}}})
        eval_ids.append(call('POST', '/eval', {'type': 'chat.mockConversation', 'name': ev['name'],
                                               'description': ev.get('description', ''), 'messages': msgs})['id'])
        created['evals'].append(ev['name'])

    result = {'suiteId': suite_id, 'simulationIds': sim_ids, 'evalSuiteId': eval_suite_id, 'evalIds': eval_ids, 'created': created}
    print(json.dumps(result, indent=2))
    if out_path:
        json.dump(result, open(out_path, 'w'), indent=2)


if __name__ == '__main__':
    main()
