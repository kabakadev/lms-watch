"""Detect new or changed Moodle content, e.g. a quiz posted with no announcement.

python watcher.py            normal run (what the timer does)
python watcher.py --dry      print alerts, save nothing
python watcher.py --reset    forget the snapshot (next run re-baselines silently)
"""
import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import main
from reminders import DRY, push

SNAP = Path.home() / ".local/state/lms-snapshot.json"
ACTIONABLE = {"quiz", "assign", "workshop", "lesson"}


def ts(t):
    return datetime.fromtimestamp(t).strftime("%a %d %b %H:%M") if t else "?"


def save(state):
    if DRY:
        return
    SNAP.parent.mkdir(parents=True, exist_ok=True)
    tmp = SNAP.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    tmp.replace(SNAP)


def snapshot_modules(sections, quiz_info):
    out = {}
    for s in sections:
        for m in s.get("modules", []):
            if m.get("modname") == "label" or m.get("uservisible") is False:
                continue
            mid = str(m["id"])
            files = sorted(
                ([c.get("filename"), c.get("timemodified")]
                 for c in m.get("contents", []) if c.get("type") == "file"),
                key=str,
            )
            q = quiz_info.get(mid)
            out[mid] = {
                "name": m["name"],
                "modname": m["modname"],
                "dates": [[d.get("label"), d.get("timestamp")] for d in m.get("dates", [])],
                "times": [q.get("timeopen"), q.get("timeclose"), q.get("timelimit")] if q else None,
                "files": files,
            }
    return out


def describe(m):
    parts = [m["name"]]
    if m.get("times"):
        opens, closes, limit = m["times"]
        if opens:
            parts.append(f"Opens {ts(opens)}")
        if closes:
            parts.append(f"Closes {ts(closes)}")
        if limit:
            parts.append(f"Time limit {int(limit) // 60} min")
    else:
        for label, t in m.get("dates", []):
            if t:
                parts.append(f"{label.rstrip(':')}: {ts(t)}")
    return "\n".join(parts)


async def run():
    first_run = not SNAP.exists()
    old = {} if first_run else json.loads(SNAP.read_text())
    new = dict(old)
    now = time.time()

    try:
        raw = await main.moodle(
            "core_course_get_enrolled_courses_by_timeline_classification",
            {"classification": "all"},
        )
    except Exception as exc:
        if now - old.get("_err", 0) > 6 * 3600:
            push("Content watcher is blind",
                 f"Cannot reach Moodle ({type(exc).__name__}). Token expired?", "high", "warning")
            new["_err"] = now
            save(new)
        return

    courses = [c for c in raw.get("courses", []) if c["id"] not in main.JUNK_IDS]

    quiz_info = {}
    try:
        qd = await main.moodle(
            "mod_quiz_get_quizzes_by_courses",
            {f"courseids[{i}]": c["id"] for i, c in enumerate(courses)},
        )
        quiz_info = {str(q["coursemodule"]): q for q in qd.get("quizzes", [])}
    except Exception as exc:
        print("quiz details unavailable:", getattr(exc, "detail", exc))

    alerts, known, read_ok, total = [], [], 0, 0
    for c in courses:
        cid = str(c["id"])
        try:
            sections = await main.moodle("core_course_get_contents", {"courseid": c["id"]})
        except Exception as exc:
            print(f"{cid}: could not read ({getattr(exc, 'detail', exc)})")
            continue
        read_ok += 1
        cur = snapshot_modules(sections, quiz_info)
        total += len(cur)
        code = main.course_code(c["fullname"])
        known += [f"{code}: [{m['modname']}] {m['name']}" for m in cur.values() if m["modname"] in ACTIONABLE]

        prev = old.get(cid)
        if prev and not cur:
            continue  # an empty answer for a unit that had content is a glitch: keep the old snapshot
        new[cid] = cur
        if prev is None:
            continue  # first time we see this unit: baseline silently

        quiet_new, quiet_upd = [], []
        for mid, m in cur.items():
            link = f"{main.MOODLE_BASE}/mod/{m['modname']}/view.php?id={mid}"
            p = prev.get(mid)
            if p is None:
                if m["modname"] in ACTIONABLE:
                    prio = "urgent" if m["modname"] == "quiz" else "high"
                    alerts.append((prio, f"NEW {m['modname'].upper()} in {code}", describe(m), "rotating_light", link))
                else:
                    quiet_new.append(m["name"])
            elif m["modname"] in ACTIONABLE and (
                p["dates"] != m["dates"]
                or (p.get("times") and m.get("times") and p["times"] != m["times"])
            ):
                alerts.append(("high", f"CHANGED {m['modname'].upper()} in {code}", describe(m), "warning", link))
            elif m["files"] and p["files"] != m["files"]:
                quiet_upd.append(m["name"])

        if quiet_new:
            alerts.append(("low", f"{code}: {len(quiet_new)} new item(s)", "\n".join(quiet_new[:8]), "page_facing_up", None))
        if quiet_upd:
            alerts.append(("low", f"{code}: {len(quiet_upd)} updated", "\n".join(quiet_upd[:8]), "arrows_counterclockwise", None))

    if first_run:
        print("Currently visible quizzes/assignments/lessons (now treated as known):")
        print("\n".join(known) or "(none)")
        push("Content watcher is on",
             f"Tracking {total} items across {read_ok} units. You'll be alerted when anything new appears.",
             "default", "eyes")
    else:
        for prio, title, body, tags, link in alerts:
            push(title, body, prio, tags, link)

    save(new)


if __name__ == "__main__":
    if "--reset" in sys.argv:
        SNAP.unlink(missing_ok=True)
        print("snapshot cleared")
    else:
        asyncio.run(run())
