from fastapi import Form
from fastapi import Form
import asyncio
import re
import time
import os
from urllib.parse import quote

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MOODLE_BASE = "https://elearning.zetech.ac.ke"
MOODLE_URL = f"{MOODLE_BASE}/webservice/rest/server.php"
USER_TOKEN = os.environ["MOODLE_TOKEN"]  # set in the environment; never write a token in this file
API_PUBLIC = "http://localhost:8000"

# IDs to filter out (Notices, Timetables, Surveys)
JUNK_IDS = {53703, 59384, 35708, 28, 627, 644, 12672, 13128, 35283, 20, 13}


def proxied(url: str) -> str:
    """Route file downloads through this backend so the token never reaches the browser."""
    return f"{API_PUBLIC}/api/file?url={quote(url, safe='')}"


async def moodle(fn: str, params: dict | None = None):
    payload = {
        "wstoken": USER_TOKEN,
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
        raise HTTPException(status_code=403, detail=data.get("message", data["exception"]))
    return data


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
    # Only ever fetch from Moodle itself
    if not url.startswith(MOODLE_BASE + "/"):
        raise HTTPException(status_code=400, detail="Bad URL")
    target = httpx.URL(url).copy_merge_params({"token": USER_TOKEN})
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


@app.get("/api/assignment/{course_id}/{cmid}")
async def get_assignment(course_id: int, cmid: int):
    data = await moodle("mod_assign_get_assignments", {"courseids[0]": course_id})
    assigns = data["courses"][0]["assignments"] if data.get("courses") else []
    a = next((x for x in assigns if x["cmid"] == cmid), None)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")

    status = await moodle("mod_assign_get_submission_status", {"assignid": a["id"]})

    for f in a.get("introattachments", []):
        f["fileurl"] = proxied(f["fileurl"])
    sub = (status.get("lastattempt") or {}).get("submission") or {}
    for p in sub.get("plugins", []):
        for area in p.get("fileareas", []):
            for f in area.get("files", []):
                f["fileurl"] = proxied(f["fileurl"])

    return {"assignment": a, "status": status}



_cache = {"at": 0, "data": None}


def course_code(fullname: str) -> str:
    m = re.match(r"^([A-Z]{3}\s?\d{3})", fullname)
    return m.group(1) if m else fullname[:12]


def clean_event_name(name: str) -> str:
    return re.sub(r"\s+(is due|should be completed|closes|opens)$", "", name, flags=re.I)


@app.get("/api/deadlines")
async def get_deadlines(refresh: bool = False):
    # 2-minute cache so reloading the page doesn't hammer Moodle
    if not refresh and _cache["data"] and time.time() - _cache["at"] < 120:
        return _cache["data"]

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

    # 2) Everything else Moodle says needs action (forums, quizzes, ...)
    try:
        cal = await moodle("core_calendar_get_action_events_by_timesort", {
            "timesortfrom": int(time.time()) - 30 * 86400,
            "limitnum": 50,
        })
        for e in cal.get("events", []):
            if e.get("modulename") in ("assign", "forum"):
                continue  # covered above, with real submission status
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
    _cache.update(at=time.time(), data=result)
    return result


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

    # Re-fetch the files that must be kept. Saving replaces the whole file area,
    # so if any of them cannot be verified we stop before writing anything.
    uploads = []
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        for f in keep:
            url = httpx.URL(f["fileurl"]).copy_merge_params({"token": USER_TOKEN})
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
            data={"token": USER_TOKEN, "filearea": "draft", "itemid": 0},
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

    # Only assignments with "require students to click submit" need this extra step
    if str(a.get("submissiondrafts")) == "1":
        w = await moodle(
            "mod_assign_submit_for_grading",
            {"assignmentid": a["id"], "acceptsubmissionstatement": 1},
        )
        if w:
            raise HTTPException(status_code=400, detail=w[0].get("message", "Could not submit for grading"))

    _cache["at"] = 0  # force fresh statuses on the dashboard
    return {"ok": True, "dry_run": False, **plan}
