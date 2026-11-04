"""Moodle client API: course content, deadlines and submissions.

Runs two ways:
  * Web app (LMS_WEB=1): every /api request needs a session cookie. The Moodle
    token lives only inside that encrypted cookie; the server stores none.
  * Scripts (reminders.py, watcher.py): no session; the token comes from the
    MOODLE_TOKEN environment variable.
"""
import asyncio
import hashlib
import json
import os
import re
import time
from collections import deque
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

MOODLE_BASE = "https://elearning.zetech.ac.ke"
MOODLE_URL = f"{MOODLE_BASE}/webservice/rest/server.php"

WEB_MODE = os.environ.get("LMS_WEB") == "1"
ENV_TOKEN = os.environ.get("MOODLE_TOKEN")  # scripts only; ignored in web mode
COOKIE_NAME = "lms_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
SESSION_DAYS = 30
PUBLIC_PATHS = {"/api/login", "/api/logout", "/api/health"}
ACTIVE_USER_WINDOW = 5 * 60
ACTIVE_USERS_ADMIN = "bcs-03-0068/2026"

_key = os.environ.get("SESSION_KEY")
fernet = Fernet(_key) if _key else None
if WEB_MODE and not fernet:
    raise RuntimeError("LMS_WEB=1 requires SESSION_KEY")

# IDs to filter out (Notices, Timetables, Surveys)
JUNK_IDS = {53703, 59384, 35708, 28, 627, 644, 12672, 13128, 35283, 20, 13}


# --------------------------------------------------------------------------
# Session handling
# --------------------------------------------------------------------------
_session_token: ContextVar = ContextVar("session_token", default=None)
_session_username: ContextVar = ContextVar("session_username", default=None)
_active_sessions: dict[str, float] = {}


def record_active_session(request: Request) -> None:
    """Track authenticated browser sessions in this process only."""
    raw_cookie = request.cookies.get(COOKIE_NAME)
    if not raw_cookie:
        return

    now = time.time()
    cutoff = now - ACTIVE_USER_WINDOW
    for session_id, last_seen in list(_active_sessions.items()):
        if last_seen < cutoff:
            del _active_sessions[session_id]

    session_id = hashlib.sha256(raw_cookie.encode()).hexdigest()
    _active_sessions[session_id] = now


def current_token() -> str:
    tok = _session_token.get()
    if not tok and not WEB_MODE:
        tok = ENV_TOKEN  # never used in web mode
    if not tok:
        raise HTTPException(status_code=401, detail="Not logged in")
    return tok


def read_session(request: Request):
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or not fernet:
        return None
    try:
        payload = fernet.decrypt(raw.encode(), ttl=SESSION_DAYS * 86400).decode()
    except InvalidToken:
        return None
    try:
        session = json.loads(payload)
    except ValueError:
        return payload
    if not isinstance(session, dict) or not isinstance(session.get("token"), str):
        return None
    _session_username.set(session.get("username"))
    return session["token"]


async def require_session(request: Request):
    # async on purpose: the ContextVar must be set inside the request's own task
    path = request.url.path
    if path in PUBLIC_PATHS or not path.startswith("/api/"):
        return
    token = read_session(request)
    if WEB_MODE and not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    _session_token.set(token)
    if WEB_MODE:
        record_active_session(request)


app = FastAPI(
    dependencies=[Depends(require_session)],
    docs_url=None if WEB_MODE else "/docs",
    redoc_url=None,
    openapi_url=None if WEB_MODE else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Moodle helpers
# --------------------------------------------------------------------------
def course_code(fullname: str) -> str:
    m = re.match(r"^([A-Z]{3}\s?\d{3})", fullname)
    return m.group(1) if m else fullname[:12]


def clean_event_name(name: str) -> str:
    return re.sub(r"\s+(is due|should be completed|closes|opens)$", "", name, flags=re.I)


def proxied(url: str) -> str:
    """Route file downloads through this server so the token never reaches the page."""
    return f"/api/file?url={quote(url, safe='')}"


async def moodle(fn: str, params: dict | None = None, token: str | None = None):
    payload = {
        "wstoken": token or current_token(),
        "wsfunction": fn,
        "moodlewsrestformat": "json",
        **(params or {}),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(MOODLE_URL, data=payload)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to reach LMS")
    data = r.json()
    if isinstance(data, dict) and "exception" in data:
        status = 401 if data.get("errorcode") == "invalidtoken" else 403
        raise HTTPException(status_code=status, detail=data.get("message", data["exception"]))
    return data


# --------------------------------------------------------------------------
# Auth endpoints
# --------------------------------------------------------------------------
_attempts: deque = deque(maxlen=50)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/active-users")
async def active_users():
    if _session_username.get() != ACTIVE_USERS_ADMIN:
        raise HTTPException(status_code=403, detail="Active-user metrics are restricted")

    now = time.time()
    cutoff = now - ACTIVE_USER_WINDOW
    active = sum(last_seen >= cutoff for last_seen in _active_sessions.values())
    return {
        "active_users": active,
        "window_seconds": ACTIVE_USER_WINDOW,
        "observed_at": int(now),
    }


@app.post("/api/login")
async def login(response: Response, username: str = Form(...), password: str = Form(...)):
    if not fernet:
        raise HTTPException(status_code=503, detail="Sessions are not configured")

    now = time.time()
    while _attempts and now - _attempts[0] > 300:
        _attempts.popleft()
    if len(_attempts) >= 10:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    _attempts.append(now)

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{MOODLE_BASE}/login/token.php",
            data={"username": username.strip(), "password": password, "service": "moodle_mobile_app"},
        )
    try:
        data = r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Unexpected reply from the LMS")
    token = data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Login failed. Check your username and password.")

    info = await moodle("core_webservice_get_site_info", token=token)
    session = json.dumps({
        "token": token,
        "username": info.get("username") or username.strip(),
    })
    response.set_cookie(
        COOKIE_NAME,
        fernet.encrypt(session.encode()).decode(),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/",
    )
    return {"ok": True, "fullname": info.get("fullname")}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
async def me():
    info = await moodle("core_webservice_get_site_info")
    return {"fullname": info.get("fullname")}


# --------------------------------------------------------------------------
# Courses, content, files
# --------------------------------------------------------------------------
@app.get("/api/my-courses")
async def get_my_courses():
    data = await moodle(
        "core_course_get_enrolled_courses_by_timeline_classification",
        {"classification": "all"},
    )
    if "courses" in data:
        return {"courses": [c for c in data["courses"] if c["id"] not in JUNK_IDS]}
    return data


@app.get("/api/course-content/{course_id}")
async def get_course_content(course_id: int):
    data = await moodle("core_course_get_contents", {"courseid": course_id})
    if isinstance(data, list):
        for section in data:
            for mod in section.get("modules", []):
                for content in mod.get("contents", []):
                    if "fileurl" in content:
                        content["fileurl"] = proxied(content["fileurl"])
    return data


@app.get("/api/file")
async def proxy_file(url: str):
    # Only Moodle's own file endpoint, nothing else
    if not url.startswith(MOODLE_BASE + "/webservice/pluginfile.php/"):
        raise HTTPException(status_code=400, detail="Bad URL")
    target = httpx.URL(url).copy_merge_params({"token": current_token()})
    client = httpx.AsyncClient(timeout=None)
    r = await client.send(client.build_request("GET", target), stream=True)

    async def gen():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    headers = {
        h: r.headers[h]
        for h in ("content-type", "content-disposition", "content-length")
        if h in r.headers
    }
    return StreamingResponse(gen(), headers=headers, status_code=r.status_code)


# --------------------------------------------------------------------------
# Assignments and submissions
# --------------------------------------------------------------------------
async def find_assignment(course_id: int, cmid: int):
    data = await moodle("mod_assign_get_assignments", {"courseids[0]": course_id})
    assigns = data["courses"][0]["assignments"] if data.get("courses") else []
    a = next((x for x in assigns if x["cmid"] == cmid), None)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return a


def file_config(a: dict, name: str, default):
    for c in a.get("configs", []):
        if c["plugin"] == "file" and c["name"] == name:
            return c["value"]
    return default


@app.get("/api/assignment/{course_id}/{cmid}")
async def get_assignment(course_id: int, cmid: int):
    a = await find_assignment(course_id, cmid)
    status = await moodle("mod_assign_get_submission_status", {"assignid": a["id"]})

    for f in a.get("introattachments", []):
        f["fileurl"] = proxied(f["fileurl"])
    sub = (status.get("lastattempt") or {}).get("submission") or {}
    for p in sub.get("plugins", []):
        for area in p.get("fileareas", []):
            for f in area.get("files", []):
                f["fileurl"] = proxied(f["fileurl"])

    return {"assignment": a, "status": status}


@app.post("/api/assignment/{course_id}/{cmid}/files")
async def submit_files(
    course_id: int,
    cmid: int,
    files: list[UploadFile] = File(...),
    dry_run: bool = Form(False),
):
    a = await find_assignment(course_id, cmid)
    status = await moodle("mod_assign_get_submission_status", {"assignid": a["id"]})
    sub = (status.get("lastattempt") or {}).get("submission") or {}

    existing = [
        f
        for p in sub.get("plugins", []) if p.get("type") == "file"
        for area in p.get("fileareas", [])
        for f in area.get("files", [])
    ]
    new = {f.filename: f for f in files}
    old_names = {f["filename"] for f in existing}
    keep = [f for f in existing if f["filename"] not in new]
    plan = {
        "keep": [f["filename"] for f in keep],
        "replace": [n for n in new if n in old_names],
        "add": [n for n in new if n not in old_names],
    }
    plan["total"] = len(keep) + len(new)
    plan["max"] = int(file_config(a, "maxfilesubmissions", 1))
    if plan["total"] > plan["max"]:
        raise HTTPException(
            status_code=400,
            detail=f"{plan['total']} files would be submitted but the limit is {plan['max']}",
        )

    # Saving replaces the whole file area, so re-fetch what must be kept and
    # stop before writing anything if any of it cannot be verified.
    token = current_token()
    uploads = []
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        for f in keep:
            url = httpx.URL(f["fileurl"]).copy_merge_params({"token": token})
            r = await client.get(url)
            if r.status_code != 200 or len(r.content) != f.get("filesize"):
                raise HTTPException(
                    status_code=502,
                    detail=f"Could not verify existing file '{f['filename']}'; nothing was changed",
                )
            uploads.append((f["filename"], r.content))

        if dry_run:
            return {"ok": True, "dry_run": True, **plan}

        for f in files:
            uploads.append((f.filename, await f.read()))

        up = await client.post(
            f"{MOODLE_BASE}/webservice/upload.php",
            data={"token": token, "filearea": "draft", "itemid": 0},
            files={f"file_{i + 1}": (n, c) for i, (n, c) in enumerate(uploads)},
        )

    items = up.json()
    if isinstance(items, dict) and "error" in items:
        raise HTTPException(status_code=400, detail=items["error"])
    itemid = items[0]["itemid"]

    warnings = await moodle(
        "mod_assign_save_submission",
        {"assignmentid": a["id"], "plugindata[files_filemanager]": itemid},
    )
    if warnings:
        raise HTTPException(status_code=400, detail=warnings[0].get("message", "Moodle rejected the save"))

    # Only assignments that make students click "submit" need this extra step
    if str(a.get("submissiondrafts")) == "1":
        w = await moodle(
            "mod_assign_submit_for_grading",
            {"assignmentid": a["id"], "acceptsubmissionstatement": 1},
        )
        if w:
            raise HTTPException(status_code=400, detail=w[0].get("message", "Could not submit for grading"))

    _cache.pop(cache_key(), None)  # fresh statuses on the dashboard
    return {"ok": True, "dry_run": False, **plan}


# --------------------------------------------------------------------------
# Deadlines (cached per user)
# --------------------------------------------------------------------------
_cache: dict = {}


def cache_key() -> str:
    return hashlib.sha256(current_token().encode()).hexdigest()


async def all_action_events(since: int):
    """Page through Moodle's action events (it caps each page at 50)."""
    events, after = [], 0
    for _ in range(10):
        params = {"timesortfrom": since, "limitnum": 50}
        if after:
            params["aftereventid"] = after
        page = (await moodle("core_calendar_get_action_events_by_timesort", params)).get("events", [])
        events += page
        if len(page) < 50:
            break
        after = page[-1]["id"]
    return events


@app.get("/api/deadlines")
async def get_deadlines(refresh: bool = False):
    key = cache_key()
    hit = _cache.get(key)
    if not refresh and hit and time.time() - hit[0] < 120:
        return hit[1]

    raw = await moodle(
        "core_course_get_enrolled_courses_by_timeline_classification",
        {"classification": "all"},
    )
    courses = [c for c in raw.get("courses", []) if c["id"] not in JUNK_IDS]
    by_id = {c["id"]: c for c in courses}

    # 1) Assignments, with real submission status
    data = await moodle(
        "mod_assign_get_assignments",
        {f"courseids[{i}]": c["id"] for i, c in enumerate(courses)},
    )
    items = [(c["id"], a) for c in data.get("courses", []) for a in c.get("assignments", [])]

    sem = asyncio.Semaphore(5)  # be polite to the university server

    async def status_of(a):
        async with sem:
            try:
                s = await moodle("mod_assign_get_submission_status", {"assignid": a["id"]})
                la = s.get("lastattempt") or {}
                return (la.get("submission") or {}).get("status", "new"), bool(la.get("graded"))
            except HTTPException:
                return "unknown", False

    statuses = await asyncio.gather(*(status_of(a) for _, a in items))

    out = []
    for (cid, a), (st, graded) in zip(items, statuses):
        out.append({
            "key": f"assign-{a['id']}",
            "kind": "assign",
            "course_id": cid,
            "course_code": course_code(by_id[cid]["fullname"]),
            "course_name": by_id[cid]["fullname"],
            "cmid": a["cmid"],
            "assignid": a["id"],
            "name": a["name"],
            "duedate": a["duedate"],
            "status": st,
            "graded": graded,
        })

    # 2) Everything else Moodle says needs action (quizzes, ...); forums are skipped
    try:
        for e in await all_action_events(int(time.time()) - 30 * 86400):
            if e.get("modulename") in ("assign", "forum"):
                continue  # assignments are covered above with real status
            course = e.get("course") or {}
            if course.get("id") not in by_id:
                continue  # skips notices/timetable courses
            m = re.search(r"[?&]id=(\d+)", e.get("url") or "")
            out.append({
                "key": f"event-{e['id']}",
                "kind": e.get("modulename") or "event",
                "course_id": course["id"],
                "course_code": course_code(by_id[course["id"]]["fullname"]),
                "course_name": by_id[course["id"]]["fullname"],
                "cmid": int(m.group(1)) if m else None,
                "assignid": None,
                "name": clean_event_name(e["name"]),
                "duedate": e["timesort"],
                "status": "open",
                "graded": False,
            })
    except HTTPException as exc:
        print("calendar events skipped:", exc.detail)

    out.sort(key=lambda x: (x["duedate"] == 0, x["duedate"]))

    result = {"items": out}
    _cache[key] = (time.time(), result)
    if len(_cache) > 50:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
    return result


# --------------------------------------------------------------------------
# Frontend (present only in the Docker image, built from ./frontend)
# --------------------------------------------------------------------------
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
