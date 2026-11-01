import html
"""Moodle deadline reminders -> desktop notification + phone push (ntfy).

python reminders.py          normal run (what the timer does)
python reminders.py --dry    print what would be sent, change nothing
python reminders.py --test   send a test notification now
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path

import main  # reuses the Moodle helpers and the token handling

NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh")
NTFY_TOPIC = os.environ["NTFY_TOPIC"]
STATE_FILE = Path.home() / ".local/state/lms-reminders.json"
THRESHOLDS = [72, 24, 6, 2, 1, 0.5]  # hours before the deadline
DRY = "--dry" in sys.argv


def push(title, body, priority="default", tags="", click=None):
    title, body = html.unescape(title), html.unescape(body)
    if DRY:
        print(f"[{priority}] {title} | {body}")
        return
    headers = {"Title": title, "Priority": priority, "Tags": tags}
    if click:
        headers["Click"] = click
    try:
        req = urllib.request.Request(f"{NTFY_URL}/{NTFY_TOPIC}", data=body.encode(), headers=headers)
        urllib.request.urlopen(req, timeout=15)
    except Exception as exc:
        print("phone push failed:", exc)
    try:
        urgent = priority in ("high", "urgent")
        subprocess.run(["notify-send", "-u", "critical" if urgent else "normal", title, body], check=False)
    except FileNotFoundError:
        print("notify-send not installed; desktop notification skipped")


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state):
    if DRY:
        return
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state))


def left(hours):
    if hours < 1:
        return f"{max(int(hours * 60), 0)} min"
    if hours < 48:
        return f"{hours:.0f} h"
    return f"{hours / 24:.0f} days"


async def run():
    state = load_state()
    now = time.time()

    try:
        data = await main.get_deadlines(refresh=True)
    except Exception as exc:
        if now - state.get("_error_alert", 0) > 6 * 3600:
            push("Deadline reminders are blind",
                 f"Cannot reach Moodle ({type(exc).__name__}). Token expired?", "high", "warning")
            state["_error_alert"] = now
        save_state(state)
        return

    pending = [i for i in data["items"] if i["status"] != "submitted" and i["duedate"]]
    live = set()

    for it in pending:
        key = f"{it['key']}@{it['duedate']}"
        live.add(key)
        sent = state.setdefault(key, [])
        hours = (it["duedate"] - now) / 3600
        click = f"{main.MOODLE_BASE}/mod/assign/view.php?id={it['cmid']}" if it.get("cmid") else None
        when = datetime.fromtimestamp(it["duedate"]).strftime("%a %d %b %H:%M")
        note = "DRAFT, NOT SUBMITTED!\n" if it["status"] == "draft" else ""
        label = f"{it['course_code']}: {it['name']}"

        if hours > 0:
            hit = [t for t in THRESHOLDS if hours <= t]
            if hit and min(hit) not in sent:
                t = min(hit)
                prio = "urgent" if t <= 1 else "high" if t <= 6 else "default"
                push(f"Due in {left(hours)}", f"{label}\n{note}Due {when}", prio, "alarm_clock", click)
                sent.extend(hit)
        elif hours > -48 and "overdue" not in sent:
            push("OVERDUE", f"{label}\n{note}Was due {when}. Moodle may still accept late work, so submit now.",
                 "urgent", "rotating_light", click)
            sent.append("overdue")

    today = date.today().isoformat()
    soon = [i for i in pending if 0 < i["duedate"] - now < 7 * 86400]
    if soon and datetime.now().hour >= 7 and state.get("_digest") != today:
        lines = [f"{datetime.fromtimestamp(i['duedate']):%a %H:%M}  {i['course_code']}: {i['name']}" for i in soon]
        push(f"{len(soon)} deadline(s) in the next 7 days", "\n".join(lines), "default", "calendar")
        state["_digest"] = today

    for k in [k for k in state if not k.startswith("_") and k not in live]:
        del state[k]
    save_state(state)


if __name__ == "__main__":
    if "--test" in sys.argv:
        push("Test: deadline reminders work",
             "If you see this on your phone and desktop, you're set.", "high", "white_check_mark")
    else:
        asyncio.run(run())
