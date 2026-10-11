#!/usr/bin/env bash
# Validate docs/design/cards.json: vocabulary, counts and print-page coverage.
set -euo pipefail
exec python3 - "${1:-docs/design/cards.json}" <<'PY'
import json, sys

path = sys.argv[1]
try:
    doc = json.load(open(path, encoding="utf-8"))
    cards = doc["cards"]
except Exception as exc:  # noqa: BLE001
    sys.exit(f"{path}: cannot read cards: {exc}")

errors = []
colours = set(doc["colours"])
slots = doc["half_orb_slots"]["order"]
achievements = set(doc["achievements"]["printed_on_cards"])
ops = {"draft", "draw", "discard", "discard_hand", "build", "resell", "resell_per_supply_influence",
       "opponent_resells", "flip", "steal_credits", "steal_module", "gain_credit_per_hand_card",
       "each_player_loses_credits", "target_discards", "each_opponent_discards", "look_at_opponent_hand",
       "that_opponent_discards", "that_opponent_discards_all_agents", "choose_one", "shuttle_red_orbs_pay",
       "exchange_station", "neighbours_exchange_stations"}
flips = {"own", "any_one", "any_two", "any_number", "each_player", "neighbours_of_target", "all_to_terran_outpost"}
ids = [c.get("id") for c in cards]
kinds = {c.get("kind") for c in cards}
if len(set(ids)) != len(ids):
    errors.append("duplicate card id")


def check_ops(i, seq):
    for o in seq or []:
        if o.get("op") not in ops:
            errors.append(f"{i}: unknown op {o.get('op')}")
        if o.get("op") == "flip" and o.get("who") not in flips:
            errors.append(f"{i}: unknown flip target {o.get('who')}")
        if o.get("op") == "steal_module" and o.get("kind") not in kinds:
            errors.append(f"{i}: steal_module names unknown kind {o.get('kind')}")
        for box in o.get("options", []):
            check_ops(i, box)


sums, pages = {}, {}
for c in cards:
    i = c.get("id", "?")
    if c.get("type") not in ("station", "module", "agent", "influence", "info"):
        errors.append(f"{i}: unknown type")
    if c.get("set") not in ("base", "kickstarter"):
        errors.append(f"{i}: unknown set")
    if not c.get("name") or not c.get("printed_name"):
        errors.append(f"{i}: name missing")
    if any(x not in colours for x in c.get("cost", []) + c.get("orbs", [])):
        errors.append(f"{i}: unknown colour in cost or orbs")
    if any(a not in achievements for a in c.get("achievements", [])):
        errors.append(f"{i}: unknown achievement")
    h = c.get("half_orbs")
    if c["type"] in ("station", "module"):
        if not isinstance(h, dict) or list(h) != slots or any(v is not None and v not in colours for v in h.values()):
            errors.append(f"{i}: half_orbs must hold the six slots in order")
        if not any(h.values()):
            errors.append(f"{i}: no half-orb, the card could never connect")
    elif h is not None:
        errors.append(f"{i}: only Stations and Modules have half_orbs")
    for box in c.get("main_action") or []:
        check_ops(i, box)
    for key in ("on_play", "on_discard", "passive", "on_flip_to"):
        check_ops(i, c.get(key))
    check_ops(i, (c.get("supply_effect") or {}).get("then"))
    if c.get("other_side") not in (None, *ids):
        errors.append(f"{i}: other_side names an unknown card")
    n = sum(len(s["pages"]) for s in c.get("sources", []))
    if c.get("count", -1) > 0 and c["type"] != "info" and n != c["count"]:
        errors.append(f"{i}: count {c.get('count')} but {n} source pages")
    if c.get("count"):
        for s in c["sources"]:
            for p in s["pages"]:
                if p in pages.setdefault(s["pdf"], set()):
                    errors.append(f"{i}: page {p} of {s['pdf']} is used twice")
                pages[s["pdf"]].add(p)
    key = (c["set"], c["type"])
    sums[key] = sums.get(key, 0) + c.get("count", 0)

for set_name, want in doc["totals"].items():
    for type_name, n in want.items():
        if sums.get((set_name, type_name), 0) != n:
            errors.append(f"{set_name} {type_name}: {sums.get((set_name, type_name), 0)} copies, expected {n}")
for pdf, used in pages.items():
    if used != set(range(1, len(used) + 1)):
        errors.append(f"{pdf}: pages are not a full run 1..{len(used)}: {sorted(used)}")

if errors:
    sys.exit("\n".join(f"{path}: {e}" for e in errors))
print(f"{path}: {len(cards)} faces, {sum(c['count'] for c in cards)} cards, ok")
PY
