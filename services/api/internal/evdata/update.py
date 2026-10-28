#!/usr/bin/env python3
"""Régénère models.json depuis Open EV Data (https://github.com/KilowattApp/open-ev-data, MIT avec
attribution) : seuls les champs dont Zelo a besoin pour estimer l'autonomie et filtrer les bornes.

    python3 -I services/api/internal/evdata/update.py chemin/vers/open-ev-data/data/ev-data.json
"""
import json
import sys
from pathlib import Path

src = json.load(open(sys.argv[1], encoding="utf-8"))
out = []
for v in src["data"]:
    battery = v.get("usable_battery_size")
    use = (v.get("energy_consumption") or {}).get("average_consumption")
    # Les valeurs invraisemblables (erreurs de saisie de la source) sont écartées.
    if v.get("vehicle_type", "car") != "car" or not battery or not use or not 5 <= battery <= 250 or not 6 <= use <= 40:
        continue
    ac, dc = v.get("ac_charger") or {}, v.get("dc_charger") or {}
    out.append({
        "id": v["id"],
        "brand": v["brand"],
        "model": v["model"],
        "variant": v.get("variant") or "",
        "year": v.get("release_year"),
        "batteryKwh": battery,
        "kwhPer100km": use,
        "acKw": ac.get("max_power"),
        "dcKw": dc.get("max_power"),
        "ports": sorted(set((ac.get("ports") or []) + (dc.get("ports") or []))),
    })
out.sort(key=lambda m: (m["brand"], m["model"], -(m["year"] or 0), m["variant"]))
dest = Path(__file__).with_name("models.json")
dest.write_text(json.dumps({"updated": src["meta"]["updated_at"][:10], "models": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(out), "modèles ->", dest)
