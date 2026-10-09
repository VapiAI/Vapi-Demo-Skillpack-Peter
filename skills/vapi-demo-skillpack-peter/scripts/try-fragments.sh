#!/usr/bin/env bash
set -euo pipefail
URL="$1/vapi"; C="frag-$RANDOM"
p(){ curl -s -o /dev/null -X POST "$URL" -H 'content-type: application/json' -d "$1"; sleep "${2:-0.3}"; }
t(){ p '{"message":{"type":"transcript","transcriptType":"'$3'","role":"'$1'","transcript":"'"$2"'","call":{"id":"'$C'"}}}' "${4:-0.3}"; }
p '{"message":{"type":"status-update","status":"in-progress","call":{"id":"'$C'"}}}'
t assistant "Thanks for calling eMoneyUSA. Our" final
t assistant "our t" final
t assistant "is out of the office right now, but I'm a virtual assistant." final
t assistant "And I can help you after hours." final
t assistant "What" final
t assistant "you calling about today?" final 1
p '{"message":{"type":"conversation-update","call":{"id":"'$C'"},"messages":[{"role":"bot","message":"Thanks for calling eMoneyUSA. Our our t is out of the office right now,"},{"role":"bot","message":"but I am a virtual assistant. What are you calling about today?"}]}}' 1
t user "I need" partial
t user "I need a loan." partial
t user "I need a loan." final 1
t assistant "You can apply any time" partial
t assistant "You can apply any time at emoney u s a dot com." final 1
