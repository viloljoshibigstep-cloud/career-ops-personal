from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from pathlib import Path
import asyncio
import re
import subprocess

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PUBLIC_DIR = Path(__file__).parent.parent / "docs"

app = FastAPI(title="CareerOps API", version="1.0.0")


# ── Parsers ───────────────────────────────────────────────────────────────────

def parse_applications():
    f = DATA_DIR / "applications.md"
    if not f.exists():
        return []
    rows = []
    for line in f.read_text().splitlines():
        if not line.startswith("|"):
            continue
        if line.startswith("| #") or line.startswith("|--") or line.startswith("| <!--"):
            continue
        cols = [c.strip() for c in line.split("|") if c.strip()]
        if len(cols) < 8:
            continue
        num, date, company, role, score, region, status, cv, *rest = cols
        cover = rest[0] if len(rest) > 0 else ""
        report = rest[1] if len(rest) > 1 else ""
        notes = " | ".join(rest[2:]) if len(rest) > 2 else ""
        try:
            numeric_score = float(score)
        except ValueError:
            numeric_score = None
        rows.append({
            "id": int(num) if num.isdigit() else len(rows) + 1,
            "date": date,
            "company": company,
            "role": role,
            "score": numeric_score,
            "region": region,
            "status": status,
            "cv": cv,
            "cover": cover,
            "report": report,
            "notes": notes,
        })
    return rows


def parse_pipeline():
    f = DATA_DIR / "pipeline.md"
    if not f.exists():
        return []
    pending = []
    in_pending = False
    for line in f.read_text().splitlines():
        if line.strip() == "## Pendientes":
            in_pending = True
            continue
        if line.startswith("## "):
            in_pending = False
            continue
        if not in_pending:
            continue
        m = re.match(r"^- \[ \] (.+)", line)
        if not m:
            continue
        parts = [p.strip() for p in m.group(1).split("|")]
        pending.append({
            "url": parts[0] if len(parts) > 0 else "",
            "company": parts[1] if len(parts) > 1 else "",
            "role": parts[2] if len(parts) > 2 else "",
            "region": parts[3] if len(parts) > 3 else "",
            "date": parts[4] if len(parts) > 4 else "",
        })
    return pending


def get_job_by_id(job_id: int):
    jobs = parse_applications()
    job = next((j for j in jobs if j["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def resolve_path(rel: str) -> Path:
    if not rel:
        raise HTTPException(status_code=404, detail="Path not set")
    p = ROOT / rel
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return p


# ── API routes ────────────────────────────────────────────────────────────────

@app.get("/api/jobs")
def list_jobs(min_score: float = 0, region: str = ""):
    jobs = parse_applications()
    if min_score > 0:
        jobs = [j for j in jobs if j["score"] is not None and j["score"] >= min_score]
    if region:
        jobs = [j for j in jobs if region.lower() in j["region"].lower()]
    jobs.sort(key=lambda j: j["score"] or 0, reverse=True)
    return jobs


@app.get("/api/pipeline")
def list_pipeline():
    return parse_pipeline()


@app.get("/api/stats")
def stats():
    jobs = parse_applications()
    pipeline = parse_pipeline()
    by_region: dict[str, int] = {}
    for j in jobs:
        r = j["region"] or "Unknown"
        by_region[r] = by_region.get(r, 0) + 1
    return {
        "total": len(jobs),
        "above7": sum(1 for j in jobs if j["score"] is not None and j["score"] >= 7),
        "applied": sum(1 for j in jobs if j["status"] == "applied"),
        "interviewing": sum(1 for j in jobs if j["status"] == "interviewing"),
        "pending_eval": len(pipeline),
        "by_region": by_region,
    }


@app.post("/api/scan")
async def run_scan():
    before = len(parse_applications())
    try:
        proc = await asyncio.create_subprocess_exec(
            "npm", "run", "scan",
            cwd=str(ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        return JSONResponse({"success": False, "error": "Scan timed out after 120s"}, status_code=504)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    if proc.returncode != 0:
        return JSONResponse({"success": False, "error": stderr.decode()}, status_code=500)

    after = len(parse_applications())
    return {"success": True, "new_jobs": max(0, after - before), "output": stdout.decode()}


@app.get("/api/jobs/{job_id}/pdf")
def serve_pdf(job_id: int):
    job = get_job_by_id(job_id)
    p = resolve_path(job["cv"])
    return FileResponse(p, media_type="application/pdf")


@app.get("/api/jobs/{job_id}/cover")
def serve_cover(job_id: int):
    job = get_job_by_id(job_id)
    p = resolve_path(job["cover"])
    return {"content": p.read_text()}


@app.get("/api/jobs/{job_id}/report")
def serve_report(job_id: int):
    job = get_job_by_id(job_id)
    p = resolve_path(job["report"])
    return {"content": p.read_text()}


@app.get("/api/jobs/{job_id}/download-cv")
def download_cv(job_id: int):
    job = get_job_by_id(job_id)
    p = resolve_path(job["cv"])
    filename = f"CV_VilolJoshi_{job['company'].replace(' ', '_')}.pdf"
    return FileResponse(p, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/jobs/{job_id}/download-cover")
def download_cover(job_id: int):
    job = get_job_by_id(job_id)
    p = resolve_path(job["cover"])
    filename = f"CoverLetter_VilolJoshi_{job['company'].replace(' ', '_')}.txt"
    return PlainTextResponse(p.read_text(),
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── Static frontend — must be LAST ────────────────────────────────────────────

app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")
