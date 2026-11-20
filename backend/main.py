"""TalentAi v3 (powered by Helarik, www.helarik.com) - FastAPI + SQLite.  Run: uvicorn main:app"""
import os, re, json, math, time, hmac, hashlib, base64, sqlite3, secrets, threading, random
from contextlib import closing, asynccontextmanager
from typing import Dict, List, Optional
from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from questions import MCQ, TECH, INTERVIEW, gen_aptitude

BASE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.join(os.path.dirname(BASE), "frontend")
DB = os.path.join(BASE, "recruit_v2.db")
env = lambda k, d: float(os.getenv(k, d))
R1_PASS, R2_PASS, R3_PASS = env("R1_PASS", "60"), env("R2_PASS", "0"), env("R3_PASS", "0")   # only the assessment (R1) is gated at 60%
R1_MIN, R2_MIN, IV_ANS = int(env("R1_MINUTES", "30")), int(env("R2_MINUTES", "30")), int(env("IV_ANSWER_SECONDS", "120"))
N_R1, N_R2, N_IV, N_APT = int(env("R1_QUESTIONS", "20")), int(env("R2_QUESTIONS", "10")), int(env("IV_QUESTIONS", "15")), 4   # questions per candidate (assessment / technical / interview), generated aptitude part of the assessment
MAX_VIOL, TAB_FAIL, GRACE = int(env("MAX_VIOLATIONS", "6")), max(1, int(env("TAB_FAIL", "1"))), 20   # TAB_FAIL = tab/window changes allowed before the test is failed (1 = the first change fails it)
HARD = {"tab_switch", "window_blur"}                  # tab / window change -> test failed
ROUND_NAME = {1: "assessment", 2: "technical round", 3: "AI interview"}
WEIGHTS = (0.25, 0.30, 0.45)                       # round1, round2, interview -> all three count in the final rank
BANK_SKILLS = {x["skill"] for x in MCQ + TECH + INTERVIEW} - {"general"}
EMOS = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"]
LOCK = threading.Lock()

def _secret():
    if os.getenv("APP_SECRET"): return os.environ["APP_SECRET"].encode()
    p = os.path.join(BASE, ".secret")
    if not os.path.exists(p):
        with open(p, "w") as f: f.write(secrets.token_hex(32))
    return open(p).read().strip().encode()
SECRET = _secret()

def conn():
    c = sqlite3.connect(DB, timeout=10); c.row_factory = sqlite3.Row; return c
def run(sql, a=()):
    with closing(conn()) as c:
        cur = c.execute(sql, a); c.commit(); return cur.lastrowid
def rows(sql, a=()):
    with closing(conn()) as c: return [dict(r) for r in c.execute(sql, a).fetchall()]
def one(sql, a=()):
    r = rows(sql, a); return r[0] if r else None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, pw TEXT, role TEXT DEFAULT 'candidate', skills TEXT DEFAULT '', profile TEXT DEFAULT '{}', created REAL, photo TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS openings(id INTEGER PRIMARY KEY, title TEXT, skills TEXT, seats INTEGER, status TEXT DEFAULT 'open', deadline REAL, created REAL);
CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY, user_id INTEGER, opening_id INTEGER, status TEXT, r1 REAL, r2 REAL, r3 REAL, total REAL, rank INTEGER,
  r1_q TEXT, r2_q TEXT, iv_q TEXT, r1_start REAL, r2_start REAL, violations INTEGER DEFAULT 0, report TEXT, created REAL, UNIQUE(user_id, opening_id));
CREATE TABLE IF NOT EXISTS iv_answers(id INTEGER PRIMARY KEY, app_id INTEGER, qid INTEGER, transcript TEXT, metrics TEXT);
CREATE TABLE IF NOT EXISTS proctor_events(id INTEGER PRIMARY KEY, app_id INTEGER, rnd INTEGER, kind TEXT, detail TEXT, created REAL);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER, msg TEXT, kind TEXT, read INTEGER DEFAULT 0, created REAL);
"""
def hash_pw(p, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", p.encode(), salt.encode(), 200_000).hex()
def check_pw(p, stored):
    return hmac.compare_digest(hash_pw(p, stored.split("$")[0]), stored)

def init_db():
    with closing(conn()) as c:
        c.executescript(SCHEMA)
        if "photo" not in {r[1] for r in c.execute("PRAGMA table_info(users)")}: c.execute("ALTER TABLE users ADD COLUMN photo TEXT DEFAULT ''")   # upgrade from v2
        c.commit()
    email, pw = os.getenv("ADMIN_EMAIL", "admin@recruit.local"), os.getenv("ADMIN_PASSWORD", "Admin@12345")
    if not one("SELECT id FROM users WHERE role='admin'"):
        run("INSERT INTO users(name,email,pw,role,created) VALUES(?,?,?,?,?)", ("Administrator", email.lower(), hash_pw(pw), "admin", time.time()))
        print(f"[setup] admin created: {email} / {pw}")

def token_make(uid, role, ttl=8 * 3600):
    p = base64.urlsafe_b64encode(json.dumps({"uid": uid, "role": role, "exp": time.time() + ttl}).encode()).decode().rstrip("=")
    return p + "." + hmac.new(SECRET, p.encode(), hashlib.sha256).hexdigest()
def token_read(t):
    try:
        p, s = t.split(".")
        if not hmac.compare_digest(s, hmac.new(SECRET, p.encode(), hashlib.sha256).hexdigest()): return None
        d = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        return d if d["exp"] > time.time() else None
    except Exception: return None

def user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "): raise HTTPException(401, "Not authenticated")
    d = token_read(authorization[7:])
    if not d: raise HTTPException(401, "Session expired, please login again")
    u = one("SELECT * FROM users WHERE id=?", (d["uid"],))
    if not u: raise HTTPException(401, "Unknown user")
    return u
def cand(u=Depends(user)):
    if u["role"] != "candidate": raise HTTPException(403, "Candidates only")
    return u
def admin(u=Depends(user)):
    if u["role"] != "admin": raise HTTPException(403, "Admin only")
    return u

def skl(s): return sorted({x.strip().lower()[:30] for x in re.split(r"[,;/]", s or "") if x.strip()})
def notify(uid, msg, kind="info"): run("INSERT INTO notifications(user_id,msg,kind,created) VALUES(?,?,?,?)", (uid, msg, kind, time.time()))
def avg(xs):
    xs = [x for x in xs if x is not None]; return round(sum(xs) / len(xs), 1) if xs else None
def clamp(v, lo=0.0, hi=100.0): return max(lo, min(hi, float(v)))
def get_app(aid, u):
    a = one("SELECT a.*, o.title FROM applications a JOIN openings o ON o.id=a.opening_id WHERE a.id=? AND a.user_id=?", (aid, u["id"]))
    if not a: raise HTTPException(404, "Application not found")
    return a
def reject(a, name, custom=None):
    run("UPDATE applications SET status='rejected' WHERE id=?", (a["id"],))
    notify(a["user_id"], custom or f"Sorry, you did not clear {name} for '{a['title']}'. Please try the next openings.", "danger")
def pub(a):
    return {k: a.get(k) for k in ("id", "status", "r1", "r2", "r3", "total", "rank")} if a else None

# ---------- profile ----------
def completeness(p, photo=""):
    keys = ["full_name", "phone", "address", "city", "state", "country", "pincode", "headline", "summary", "skills"]
    done = sum(1 for k in keys if str(p.get(k, "")).strip()) + (3 if p.get("education") else 0) + (2 if p.get("experience") else 0) + (1 if photo else 0)
    return round(done / (len(keys) + 6) * 100)
PHOTO_MAX = 200 * 1024                                   # decoded bytes; the browser sends a 320x320 JPEG of ~20-40 KB
def check_photo(data):
    """Profile photo limits: JPEG/PNG/WebP data-URL, real image bytes, max 200 KB."""
    m = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})", data or "")
    if not m: raise HTTPException(400, "Profile photo must be a JPG, PNG or WebP image")
    try: raw = base64.b64decode(m.group(2), validate=True)
    except Exception: raise HTTPException(400, "Profile photo is corrupted, please upload it again")
    if len(raw) > PHOTO_MAX: raise HTTPException(400, "Profile photo is too large (max 200 KB after resizing)")
    ok = {"jpeg": raw[:3] == b"\xff\xd8\xff", "png": raw[:8] == b"\x89PNG\r\n\x1a\n", "webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"}[m.group(1)]
    if not ok: raise HTTPException(400, "Profile photo is not a valid image")
    return data
def missing(p, photo=""):
    m = []
    if not photo: m.append("photo")
    if not str(p.get("phone", "")).strip(): m.append("phone")
    if not str(p.get("city", "")).strip(): m.append("city")
    if not p.get("education"): m.append("education")
    if not str(p.get("skills", "")).strip(): m.append("skills")
    return m
class Edu(BaseModel):
    degree: str = Field(min_length=2, max_length=80); institute: str = Field(min_length=2, max_length=120)
    year: int = Field(ge=1970, le=2040); score: str = Field(default="", max_length=20)
class Exp(BaseModel):
    company: str = Field(min_length=1, max_length=100); role: str = Field(min_length=1, max_length=100)
    start: str = Field(default="", max_length=7); end: str = Field(default="", max_length=7); desc: str = Field(default="", max_length=400)
class Profile(BaseModel):
    photo: Optional[str] = Field(default=None, max_length=300_000)     # None = keep the stored photo
    full_name: str = Field(min_length=2, max_length=80); phone: str = Field(default="", max_length=20)
    headline: str = Field(default="", max_length=120); address: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=60); state: str = Field(default="", max_length=60); country: str = Field(default="", max_length=60); pincode: str = Field(default="", max_length=10)
    linkedin: str = Field(default="", max_length=200); github: str = Field(default="", max_length=200); summary: str = Field(default="", max_length=600)
    skills: str = Field(default="", max_length=300)
    education: List[Edu] = Field(default_factory=list, max_length=6); experience: List[Exp] = Field(default_factory=list, max_length=8)

# ---------- question selection (unique per candidate) ----------
def shuffled(x):
    idx = list(range(len(x["o"]))); random.shuffle(idx)
    return {"q": x["q"], "o": [x["o"][i] for i in idx], "a": idx.index(x["a"]), "skill": x["skill"]}
def usage(oid):
    u = {}
    for r in rows("SELECT r1_q,r2_q,iv_q FROM applications WHERE opening_id=?", (oid,)):
        for col in r.values():
            for q in json.loads(col or "[]"): u[q["q"]] = u.get(q["q"], 0) + 1
    return u
def balanced(bank, skills, n, per, use):
    """Least-used questions first (random tie-break) so candidates applying together get different sets."""
    chosen = []
    def take(pool, k):
        pool = [x for x in pool if x not in chosen]; pool.sort(key=lambda x: (use.get(x["q"], 0), random.random())); chosen.extend(pool[:k])
    for s in skills: take([x for x in bank if x["skill"] == s], per)
    if len(chosen) < n: take([x for x in bank if x["skill"] == "general"], n - len(chosen))
    if len(chosen) < n: take(bank, n - len(chosen))
    random.shuffle(chosen); return chosen[:n]

# ---------- scoring ----------
FILL = ["um", "uh", "umm", "erm", "basically", "actually", "literally", "you know", "kind of", "sort of", "i mean"]
def analyze(text, dur, kw, source):
    t = text.lower(); n = len(re.findall(r"[a-z0-9'+#.]+", t))
    fill = sum(len(re.findall(r"\b" + re.escape(f) + r"\b", t)) for f in FILL)
    wpm = n / (max(dur, 1.0) / 60); hits = sum(1 for k in kw if k in t)
    rel = min(100, hits / max(1, len(kw) * 0.5) * 100) if n >= 5 else 0
    flu = max(0, 100 - min(100, fill / max(n, 1) * 500)) if n else 0
    if source != "speech" or n == 0: pace = None
    elif 100 <= wpm <= 170: pace = 100
    else: pace = max(0, 100 - abs(wpm - (100 if wpm < 100 else 170)) * 1.2)
    return {"words": n, "fillers": fill, "wpm": round(wpm) if pace is not None else None, "relevance": round(rel), "completeness": round(min(100, n / 60 * 100)),
            "fluency": round(flu), "pace": None if pace is None else round(pace), "source": source}

class Vision(BaseModel):
    ai: bool = False
    samples: int = Field(0, ge=0, le=5000); face: int = Field(0, ge=0, le=5000); eye: int = Field(0, ge=0, le=5000)
    away: int = Field(0, ge=0, le=5000); multi: int = Field(0, ge=0, le=5000)
    emo: Dict[str, float] = Field(default_factory=dict); stability: float = Field(100, ge=0, le=100)
    device: int = Field(0, ge=0, le=5000); hand: int = Field(0, ge=0, le=5000); eyeoff: int = Field(0, ge=0, le=5000)   # frames with a smart device / device in hand / eyes off-screen

def analyze_vision(v):
    """Turns browser-side face-AI measurements into indicators (no video ever reaches the server)."""
    if not v or not v.ai or v.samples < 3: return None
    face = min(v.face, v.samples); eye = min(v.eye, max(face, 1))
    emo = {e: clamp(v.emo.get(e, 0), 0, 1) for e in EMOS}; tot = sum(emo.values()) or 1; emo = {e: emo[e] / tot for e in EMOS}
    stress = emo["fearful"] + emo["sad"] + emo["angry"] + emo["disgusted"] + emo["surprised"] * 0.5
    nerv = clamp(stress * 150); face_pct = face / v.samples * 100; eye_pct = eye / max(face, 1) * 100
    conf = 0.35 * eye_pct + 0.25 * (100 - nerv) + 0.20 * v.stability + 0.20 * face_pct
    pc = {e: round(emo[e] * 100, 1) for e in EMOS}
    return {"samples": v.samples, "face_pct": round(face_pct, 1), "eye_contact": round(eye_pct, 1), "nervousness": round(nerv, 1), "stability": round(v.stability, 1),
            "confidence": round(conf, 1), "emotions": pc, "dominant": max(pc, key=pc.get), "multi": v.multi,
            "device_pct": round(min(v.device, v.samples) / v.samples * 100, 1), "hand_pct": round(min(v.hand, v.samples) / v.samples * 100, 1), "eye_off_pct": round(min(v.eyeoff, face) / max(face, 1) * 100, 1)}

def build_report(a):
    qs = {x["id"]: x for x in json.loads(a["iv_q"])}; per, vis = [], []
    for x in rows("SELECT * FROM iv_answers WHERE app_id=? ORDER BY id", (a["id"],)):
        m = json.loads(x["metrics"]); v = m.get("vision")
        per.append({"question": qs[x["qid"]]["q"], "transcript": x["transcript"], "confidence": v["confidence"] if v else None, "emotion": v["dominant"] if v else None,
                    **{k: m[k] for k in ("words", "fillers", "wpm", "relevance", "completeness", "fluency", "pace")}})
        if v: vis.append(v)
    rel, flu, pace, comp = (avg([p[k] for p in per]) for k in ("relevance", "fluency", "pace", "completeness"))
    comm = round(flu * (0.4 if pace is not None else 0.55) + comp * (0.3 if pace is not None else 0.45) + (pace or 0) * 0.3, 1)
    vision = None
    if vis:
        s = sum(v["samples"] for v in vis); w = lambda k: round(sum(v[k] * v["samples"] for v in vis) / s, 1)
        emo = {e: round(sum(v["emotions"][e] * v["samples"] for v in vis) / s, 1) for e in EMOS}
        vision = {"samples": s, "face_pct": w("face_pct"), "eye_contact": w("eye_contact"), "nervousness": w("nervousness"), "stability": w("stability"),
                  "confidence": w("confidence"), "emotions": emo, "dominant": max(emo, key=emo.get), "multi_face_events": sum(v["multi"] for v in vis),
                  "device_pct": w("device_pct"), "hand_pct": w("hand_pct"), "eye_off_pct": w("eye_off_pct")}
    ev = rows("SELECT kind, COUNT(*) n FROM proctor_events WHERE app_id=? AND rnd=3 GROUP BY kind", (a["id"],)); viol = sum(e["n"] for e in ev); disc = max(0, 100 - viol * 15)
    allev = rows("SELECT rnd, kind, COUNT(*) n FROM proctor_events WHERE app_id=? GROUP BY rnd, kind", (a["id"],)); by_round = {}
    for e in allev: by_round.setdefault(str(e["rnd"]), {})[e["kind"]] = e["n"]
    iv = round(0.45 * rel + 0.25 * comm + 0.20 * vision["confidence"] + 0.10 * disc, 1) if vision else round(0.60 * rel + 0.30 * comm + 0.10 * disc, 1)
    good, bad = [], []
    (good if rel >= 60 else bad).append("Answers were relevant and covered key concepts" if rel >= 60 else "Cover more specific concepts in answers")
    (good if flu >= 80 else bad).append("Fluent speech with few filler words" if flu >= 80 else "Reduce filler words (um, uh, basically)")
    if pace is not None: (good if pace >= 75 else bad).append("Comfortable speaking pace" if pace >= 75 else "Adjust speaking pace (100-170 words/min)")
    (good if comp >= 70 else bad).append("Well-developed answers" if comp >= 70 else "Give fuller answers with examples")
    if vision:
        (good if vision["confidence"] >= 65 else bad).append("Confident, composed delivery" if vision["confidence"] >= 65 else "Work on composure and steady delivery")
        (good if vision["eye_contact"] >= 70 else bad).append("Good attention towards the screen" if vision["eye_contact"] >= 70 else "Maintain more eye contact with the camera")
    (good if viol == 0 else bad).append("No proctoring violations" if viol == 0 else f"{viol} proctoring violation(s) recorded")
    return {"interview": {"score": iv, "knowledge": rel, "communication": {"score": comm, "fluency": flu, "pace": pace, "completeness": comp, "avg_wpm": avg([p["wpm"] for p in per]),
            "filler_words": sum(p["fillers"] for p in per), "total_words": sum(len(p["transcript"].split()) for p in per)},
            "vision": vision, "discipline": disc, "per_question": per, "strengths": good, "improvements": bad},
            "proctoring": {"violations": viol, "by_kind": {e["kind"]: e["n"] for e in ev}, "total_all_rounds": sum(e["n"] for e in allev), "by_round": by_round},
            "note": "Emotion/confidence values come from an in-browser face-expression model and are indicative only; they are not a diagnosis of personality or honesty. A human reviewer should make the final decision. No video was stored."}

# ---------- selection ----------
def finalize(oid):
    o = one("SELECT * FROM openings WHERE id=?", (oid,))
    if not o or o["status"] != "open": return None
    aw = rows("SELECT * FROM applications WHERE opening_id=? AND status='awaiting' ORDER BY total DESC, r3 DESC, id ASC", (oid,))
    for i, a in enumerate(aw):
        if i < o["seats"]:
            run("UPDATE applications SET status='selected', rank=? WHERE id=?", (i + 1, a["id"]))
            notify(a["user_id"], f"Congratulations! You are selected for '{o['title']}'. HR will contact you soon.", "success")
        else:
            run("UPDATE applications SET status='rejected', rank=? WHERE id=?", (i + 1, a["id"]))
            notify(a["user_id"], f"Sorry, you were not selected for '{o['title']}'. Please try the next openings.", "danger")
    for a in rows("SELECT * FROM applications WHERE opening_id=? AND status IN ('round1','round2','interview')", (oid,)):
        run("UPDATE applications SET status='rejected' WHERE id=?", (a["id"],))
        notify(a["user_id"], f"The opening '{o['title']}' closed before you completed all rounds. Please try the next openings.", "danger")
    run("UPDATE openings SET status='closed' WHERE id=?", (oid,))
    return min(len(aw), o["seats"])

def auto_loop():
    while True:
        time.sleep(20)
        try:
            for o in rows("SELECT id FROM openings WHERE status='open' AND deadline IS NOT NULL AND deadline<=?", (time.time(),)): finalize(o["id"])
        except Exception as e: print("auto-finalize error:", e)

@asynccontextmanager
async def lifespan(_):
    init_db(); threading.Thread(target=auto_loop, daemon=True).start(); yield

app = FastAPI(title="TalentAi", lifespan=lifespan, docs_url=None, redoc_url=None)
CDN = "https://cdn.jsdelivr.net"
TFM = "https://storage.googleapis.com https://tfhub.dev https://www.kaggle.com"      # weights of the in-browser phone/device detector (COCO-SSD)
@app.middleware("http")
async def headers(request: Request, call_next):
    r = await call_next(request)
    ev = " 'unsafe-eval'" if os.getenv("CSP_UNSAFE_EVAL") == "1" else ""
    r.headers.update({"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(self), microphone=(self), fullscreen=(self)",
        "Content-Security-Policy": f"default-src 'self'; script-src 'self' {CDN} 'wasm-unsafe-eval'{ev}; style-src 'self' {CDN} 'unsafe-inline'; img-src 'self' data: blob:; "
                                   f"media-src 'self' blob:; connect-src 'self' {CDN} {TFM}; worker-src 'self' blob:; font-src 'self' {CDN}; frame-ancestors 'none'"})
    if request.url.path.startswith("/api"): r.headers["Cache-Control"] = "no-store"
    return r

# ---------- auth ----------
class Reg(BaseModel):
    name: str = Field(min_length=2, max_length=80); email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    password: str = Field(min_length=8, max_length=128); skills: str = Field(default="", max_length=300)
class Login(BaseModel):
    email: str = Field(max_length=120); password: str = Field(max_length=128)
ATTEMPTS: Dict[str, list] = {}

@app.post("/api/register")
def register(b: Reg):
    email = b.email.lower()
    if one("SELECT id FROM users WHERE email=?", (email,)): raise HTTPException(409, "Email already registered")
    sk = ",".join(skl(b.skills)); prof = {"full_name": b.name.strip(), "skills": sk}
    uid = run("INSERT INTO users(name,email,pw,role,skills,profile,created) VALUES(?,?,?,?,?,?,?)", (b.name.strip(), email, hash_pw(b.password), "candidate", sk, json.dumps(prof), time.time()))
    notify(uid, "Welcome! Complete your profile (photo, phone, city, education, skills) to start applying.")
    return {"token": token_make(uid, "candidate")}

@app.post("/api/login")
def login(b: Login, request: Request):
    ip = request.client.host if request.client else "x"; now = time.time()
    ATTEMPTS[ip] = [t for t in ATTEMPTS.get(ip, []) if now - t < 300]
    if len(ATTEMPTS[ip]) >= 10: raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
    u = one("SELECT * FROM users WHERE email=?", (b.email.lower(),))
    if not u or not check_pw(b.password, u["pw"]): ATTEMPTS[ip].append(now); raise HTTPException(401, "Invalid email or password")
    return {"token": token_make(u["id"], u["role"])}

@app.get("/api/me")
def me(u=Depends(user)):
    p = json.loads(u["profile"] or "{}")
    return {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "skills": u["skills"], "photo": u.get("photo") or "", "completeness": completeness(p, u.get("photo")), "ready": not missing(p, u.get("photo"))}

@app.get("/api/profile")
def prof_get(u=Depends(cand)):
    p = json.loads(u["profile"] or "{}"); p.setdefault("full_name", u["name"]); p["skills"] = u["skills"]
    p.pop("photo", None)
    return {"profile": p, "photo": u.get("photo") or "", "email": u["email"], "completeness": completeness(p, u.get("photo")), "missing": missing(p, u.get("photo"))}

@app.put("/api/profile")
def prof_put(b: Profile, u=Depends(cand)):
    if b.phone and not re.fullmatch(r"[0-9+\-\s]{7,15}", b.phone): raise HTTPException(400, "Enter a valid phone number")
    if b.pincode and not re.fullmatch(r"[0-9A-Za-z\- ]{3,10}", b.pincode): raise HTTPException(400, "Enter a valid pincode (3-10 letters/digits)")
    photo = check_photo(b.photo) if b.photo else (u.get("photo") or "")
    p = b.model_dump(); p.pop("photo", None); p["skills"] = ",".join(skl(b.skills))
    run("UPDATE users SET name=?, skills=?, profile=?, photo=? WHERE id=?", (p["full_name"].strip(), p["skills"], json.dumps(p), photo, u["id"]))
    return {"completeness": completeness(p, photo), "missing": missing(p, photo)}

# ---------- candidate flow ----------
@app.get("/api/openings")
def c_openings(u=Depends(cand)):
    mine = set(skl(u["skills"])); out = []
    apps = {a["opening_id"]: a for a in rows("SELECT * FROM applications WHERE user_id=?", (u["id"],))}
    for o in rows("SELECT * FROM openings ORDER BY id DESC"):
        need = set(skl(o["skills"])); a = apps.get(o["id"])
        if (o["status"] == "open" and (not need or need & mine)) or a: o["match"] = sorted(need & mine); o["my"] = pub(a); out.append(o)
    return out

@app.get("/api/my/applications")
def my_apps(u=Depends(cand)):
    return rows("SELECT a.id,a.status,a.r1,a.r2,a.r3,a.total,a.rank,a.violations,a.created,o.title FROM applications a JOIN openings o ON o.id=a.opening_id WHERE a.user_id=? ORDER BY a.id DESC", (u["id"],))

@app.get("/api/config")
def config(u=Depends(user)):
    return {"r1_pass": R1_PASS, "r2_pass": R2_PASS, "r1_minutes": R1_MIN, "r2_minutes": R2_MIN, "weights": WEIGHTS, "r1_questions": N_R1, "r2_questions": N_R2, "iv_questions": N_IV,
            "iv_answer_seconds": IV_ANS, "max_violations": MAX_VIOL, "tab_fail": TAB_FAIL}

@app.post("/api/apply/{oid}")
def apply(oid: int, u=Depends(cand)):
    p = json.loads(u["profile"] or "{}"); p["skills"] = u["skills"]; miss = missing(p, u.get("photo"))
    if miss: raise HTTPException(400, "Complete your profile first. Missing: " + ", ".join(miss))
    o = one("SELECT * FROM openings WHERE id=?", (oid,))
    if not o or o["status"] != "open": raise HTTPException(400, "This opening is closed")
    if one("SELECT id FROM applications WHERE user_id=? AND opening_id=?", (u["id"], oid)): raise HTTPException(409, "You have already attempted this opening. Please try the next openings.")
    sk = [s for s in (skl(o["skills"]) or skl(u["skills"])) if s in BANK_SKILLS][:3]
    quota = lambda n, share: math.ceil(n * share / len(sk)) if sk else 0          # skill questions per skill; the rest comes from the general pool
    with LOCK:                                              # atomic: concurrent candidates get balanced, different sets
        use = usage(oid)
        r1 = [shuffled(x) for x in balanced(MCQ, sk, N_R1 - N_APT, quota(N_R1 - N_APT, .7), use)] + gen_aptitude(N_APT); random.shuffle(r1)
        r2 = [{"q": x["q"], "kw": x["kw"], "skill": x["skill"]} for x in balanced(TECH, sk, N_R2, quota(N_R2, .7), use)]
        iv = [{"q": x["q"], "kw": x["kw"], "skill": x["skill"]} for x in balanced(INTERVIEW, sk, N_IV, quota(N_IV, .5), use)]
        for L in (r1, r2, iv):
            for i, x in enumerate(L): x["id"] = i
        try:
            aid = run("INSERT INTO applications(user_id,opening_id,status,r1_q,r2_q,iv_q,created) VALUES(?,?,?,?,?,?,?)", (u["id"], oid, "round1", json.dumps(r1), json.dumps(r2), json.dumps(iv), time.time()))
        except sqlite3.IntegrityError: raise HTTPException(409, "You have already attempted this opening.")
    return {"application_id": aid}

def grade_round(a, n, answers):
    qs = json.loads(a[f"r{n}_q"])
    if n == 1: score = round(sum(1 for x in qs if answers.get(str(x["id"])) == x["a"]) / len(qs) * 100, 1)
    else:
        sc = []
        for x in qs:
            txt = str(answers.get(str(x["id"]), ""))[:2000].lower(); hits = sum(1 for k in x["kw"] if k in txt)
            sc.append(0 if len(txt.split()) < 8 else min(100, hits / max(1, len(x["kw"]) * 0.6) * 100))
        score = round(sum(sc) / len(sc), 1)
    gate = R1_PASS if n == 1 else R2_PASS; name = "Round 1 (Assessment)" if n == 1 else "Round 2 (Technical)"
    run(f"UPDATE applications SET r{n}=? WHERE id=?", (score, a["id"]))
    if score >= gate:
        run("UPDATE applications SET status=? WHERE id=?", ("round2" if n == 1 else "interview", a["id"]))
        nxt = "Technical round is unlocked." if n == 1 else "AI live interview is unlocked."
        return {"passed": True, "score": score, "message": f"{name} complete: {score}%." + (f" Minimum {gate:g}% met." if gate else "") + " " + nxt}
    reject(a, name); return {"passed": False, "score": score, "message": f"You scored {score}% but at least {gate:g}% is required. Sorry, you did not qualify. Please try the next openings."}

class R1(BaseModel):
    answers: Dict[str, int]
class R2(BaseModel):
    answers: Dict[str, str]
def left(a, n):
    lim = (R1_MIN if n == 1 else R2_MIN) * 60; st = a.get(f"r{n}_start")
    return lim if not st else lim - (time.time() - st)

@app.get("/api/round/{aid}/{n}")
def round_get(aid: int, n: int, u=Depends(cand)):
    a = get_app(aid, u)
    if n not in (1, 2) or a["status"] != f"round{n}": raise HTTPException(400, "This round is not available for you now")
    if not a[f"r{n}_start"]:
        a[f"r{n}_start"] = time.time(); run(f"UPDATE applications SET r{n}_start=? WHERE id=?", (a[f"r{n}_start"], aid))
    if left(a, n) <= 0:
        res = grade_round(a, n, {}); raise HTTPException(410, "Time is up. " + res["message"])
    return {"title": a["title"], "seconds_left": int(left(a, n)), "pass_mark": R1_PASS if n == 1 else R2_PASS,
            "max_violations": MAX_VIOL, "tab_fail": TAB_FAIL, "questions": [{"id": x["id"], "q": x["q"], "o": x.get("o")} for x in json.loads(a[f"r{n}_q"])]}

def submit(aid, n, answers, u):
    a = get_app(aid, u)
    if a["status"] != f"round{n}": raise HTTPException(400, "Round not available")
    late = left(a, n) < -GRACE
    res = grade_round(a, n, {} if late else answers)
    if late: res["message"] = "Time was up before submission. " + res["message"]
    return res
@app.post("/api/round/1/{aid}")
def round1(aid: int, b: R1, u=Depends(cand)): return submit(aid, 1, b.answers, u)
@app.post("/api/round/2/{aid}")
def round2(aid: int, b: R2, u=Depends(cand)): return submit(aid, 2, b.answers, u)

KINDS = {"tab_switch", "window_blur", "fullscreen_exit", "no_face", "multiple_faces", "looking_away", "copy_paste", "camera_off", "device_detected", "device_in_hand"}
class Pev(BaseModel):
    rnd: int = Field(ge=1, le=3); kind: str = Field(max_length=30); detail: str = Field(default="", max_length=100)
@app.post("/api/proctor/{aid}")
def proctor(aid: int, b: Pev, u=Depends(cand)):
    """Logs a proctoring event. A tab/window change fails the test (TAB_FAIL); other violations are counted per round (MAX_VIOLATIONS)."""
    a = get_app(aid, u)
    if b.kind not in KINDS: raise HTTPException(400, "Unknown event")
    if a["status"] != ("interview" if b.rnd == 3 else f"round{b.rnd}"): return {"violations": a["violations"], "limit": MAX_VIOL, "hard": 0, "tab_limit": TAB_FAIL, "terminate": False}
    run("INSERT INTO proctor_events(app_id,rnd,kind,detail,created) VALUES(?,?,?,?,?)", (aid, b.rnd, b.kind, b.detail, time.time()))
    run("UPDATE applications SET violations=violations+1 WHERE id=?", (aid,))
    cnt = {r["kind"]: r["n"] for r in rows("SELECT kind, COUNT(*) n FROM proctor_events WHERE app_id=? AND rnd=? GROUP BY kind", (aid, b.rnd))}
    hard = sum(n for k, n in cnt.items() if k in HARD); soft = sum(n for k, n in cnt.items() if k not in HARD)
    why = "tab" if hard >= TAB_FAIL else "violations" if soft >= MAX_VIOL else None; msg = None
    if why:
        msg = (f"Your {ROUND_NAME[b.rnd]} for '{a['title']}' was ended and marked as failed because you changed the tab/window during the test. Please try the next openings." if why == "tab" else
               f"Your {ROUND_NAME[b.rnd]} for '{a['title']}' was ended and marked as failed because of repeated proctoring violations. Please try the next openings.")
        reject(a, "", msg)
    return {"violations": soft + hard, "soft": soft, "hard": hard, "limit": MAX_VIOL, "tab_limit": TAB_FAIL, "terminate": bool(why), "reason": why, "message": msg}

@app.get("/api/interview/{aid}")
def iv_get(aid: int, u=Depends(cand)):
    a = get_app(aid, u)
    if a["status"] != "interview": raise HTTPException(400, "Interview not available")
    done = one("SELECT COUNT(*) c FROM iv_answers WHERE app_id=?", (aid,))["c"]
    return {"title": a["title"], "answered": done, "answer_seconds": IV_ANS, "max_violations": MAX_VIOL, "tab_fail": TAB_FAIL, "questions": [{"id": x["id"], "q": x["q"]} for x in json.loads(a["iv_q"])]}

class IvAns(BaseModel):
    qid: int; transcript: str = Field(default="", max_length=4000); duration: float = Field(ge=0, le=900)
    source: str = Field(default="speech", pattern="^(speech|typed)$"); vision: Optional[Vision] = None
@app.post("/api/interview/{aid}/answer")
def iv_answer(aid: int, b: IvAns, u=Depends(cand)):
    a = get_app(aid, u)
    if a["status"] != "interview": raise HTTPException(400, "Interview not available")
    qs = json.loads(a["iv_q"]); done = one("SELECT COUNT(*) c FROM iv_answers WHERE app_id=?", (aid,))["c"]
    if done >= len(qs) or qs[done]["id"] != b.qid: raise HTTPException(400, "Unexpected question")
    m = analyze(b.transcript, b.duration, qs[done]["kw"], b.source); m["vision"] = analyze_vision(b.vision)
    run("INSERT INTO iv_answers(app_id,qid,transcript,metrics) VALUES(?,?,?,?)", (aid, b.qid, b.transcript.strip(), json.dumps(m)))
    return {"answered": done + 1}

@app.post("/api/interview/{aid}/finish")
def iv_finish(aid: int, u=Depends(cand)):
    a = get_app(aid, u)
    if a["status"] != "interview": raise HTTPException(400, "Interview not available")
    if one("SELECT COUNT(*) c FROM iv_answers WHERE app_id=?", (aid,))["c"] < len(json.loads(a["iv_q"])): raise HTTPException(400, "Answer all questions first")
    rep = build_report(a); r3 = rep["interview"]["score"]; total = round(a["r1"] * WEIGHTS[0] + a["r2"] * WEIGHTS[1] + r3 * WEIGHTS[2], 1)
    rep.update({"round1": a["r1"], "round2": a["r2"], "round3": r3, "total": total, "title": a["title"]})
    run("UPDATE applications SET r3=?, total=?, report=? WHERE id=?", (r3, total, json.dumps(rep), aid))
    if r3 >= R3_PASS:
        run("UPDATE applications SET status='awaiting' WHERE id=?", (aid,))
        notify(u["id"], f"You completed all rounds for '{a['title']}' with a total score of {total}%. Final selection happens when the opening closes.")
        return {"passed": True, "score": r3, "total": total, "message": f"Interview complete: {r3}%. Total score {total}%. You will be notified when the opening closes."}
    reject(a, "Round 3 (AI interview)"); return {"passed": False, "score": r3, "total": total, "message": f"Interview score {r3}%. Sorry, you did not clear the interview. Please try the next openings."}

@app.get("/api/my/applications/{aid}/report")
def my_report(aid: int, u=Depends(cand)):
    a = get_app(aid, u)
    if not a["report"]: raise HTTPException(404, "Report not ready")
    return json.loads(a["report"])
@app.get("/api/notifications")
def notes(u=Depends(cand)): return rows("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50", (u["id"],))
@app.post("/api/notifications/read")
def notes_read(u=Depends(cand)): run("UPDATE notifications SET read=1 WHERE user_id=?", (u["id"],)); return {"ok": True}

# ---------- admin ----------
class NewOpening(BaseModel):
    title: str = Field(min_length=2, max_length=100); skills: str = Field(default="", max_length=200)
    seats: int = Field(ge=1, le=1000); deadline_hours: Optional[float] = Field(default=None, gt=0, le=24 * 365)
@app.post("/api/admin/openings")
def add_opening(b: NewOpening, u=Depends(admin)):
    dl = time.time() + b.deadline_hours * 3600 if b.deadline_hours else None
    return {"id": run("INSERT INTO openings(title,skills,seats,deadline,created) VALUES(?,?,?,?,?)", (b.title.strip(), ",".join(skl(b.skills)), b.seats, dl, time.time()))}
@app.get("/api/admin/openings")
def a_openings(u=Depends(admin)):
    out = rows("SELECT * FROM openings ORDER BY id DESC")
    for o in out:
        c = {r["status"]: r["n"] for r in rows("SELECT status, COUNT(*) n FROM applications WHERE opening_id=? GROUP BY status", (o["id"],))}
        o["counts"] = {"applicants": sum(c.values()), "in_progress": c.get("round1", 0) + c.get("round2", 0) + c.get("interview", 0), "awaiting": c.get("awaiting", 0), "selected": c.get("selected", 0), "rejected": c.get("rejected", 0)}
    return out
@app.post("/api/admin/openings/{oid}/finalize")
def a_finalize(oid: int, u=Depends(admin)):
    n = finalize(oid)
    if n is None: raise HTTPException(400, "Opening not found or already closed")
    return {"selected": n}
@app.get("/api/admin/openings/{oid}/candidates")
def a_cands(oid: int, u=Depends(admin)):
    return rows("SELECT a.id,a.status,a.r1,a.r2,a.r3,a.total,a.rank,a.violations,u.name,u.email,u.skills,u.photo FROM applications a JOIN users u ON u.id=a.user_id WHERE a.opening_id=? ORDER BY (a.total IS NULL), a.total DESC, a.r3 DESC, a.id", (oid,))
@app.get("/api/admin/selected")
def a_selected(u=Depends(admin)):
    out = rows("SELECT a.id,a.total,a.rank,o.title,u.name,u.email,u.photo,u.profile FROM applications a JOIN users u ON u.id=a.user_id JOIN openings o ON o.id=a.opening_id WHERE a.status='selected' ORDER BY a.id DESC")
    for r in out: r["phone"] = json.loads(r.pop("profile") or "{}").get("phone", "")
    return out
@app.get("/api/admin/applications/{aid}/report")
def a_report(aid: int, u=Depends(admin)):
    a = one("SELECT a.report, a.violations, u.profile, u.email, u.photo FROM applications a JOIN users u ON u.id=a.user_id WHERE a.id=?", (aid,))
    if not a or not a["report"]: raise HTTPException(404, "Report not ready")
    r = json.loads(a["report"]); r["profile"] = json.loads(a["profile"] or "{}"); r["profile"]["email"] = a["email"]; r["profile"]["photo"] = a["photo"] or ""
    r["events"] = rows("SELECT rnd,kind,detail,created FROM proctor_events WHERE app_id=? ORDER BY id", (aid,)); return r
@app.get("/api/admin/applications/{aid}/events")
def a_events(aid: int, u=Depends(admin)):
    a = one("SELECT a.id, a.status, a.violations, o.title, u.name, u.email, u.photo FROM applications a JOIN users u ON u.id=a.user_id JOIN openings o ON o.id=a.opening_id WHERE a.id=?", (aid,))
    if not a: raise HTTPException(404, "Application not found")
    a["events"] = rows("SELECT rnd,kind,detail,created FROM proctor_events WHERE app_id=? ORDER BY id", (aid,)); return a
@app.get("/api/admin/overview")
def a_over(u=Depends(admin)):
    c = lambda sql, a=(): one(sql, a)["c"]
    tot = [r["total"] for r in rows("SELECT total FROM applications WHERE total IS NOT NULL")]
    return {"openings": c("SELECT COUNT(*) c FROM openings"), "open": c("SELECT COUNT(*) c FROM openings WHERE status='open'"), "candidates": c("SELECT COUNT(*) c FROM users WHERE role='candidate'"),
            "selected": c("SELECT COUNT(*) c FROM applications WHERE status='selected'"),
            "funnel": {"applied": c("SELECT COUNT(*) c FROM applications"), "r1_attempted": c("SELECT COUNT(*) c FROM applications WHERE r1 IS NOT NULL"),
                       "r1_cleared": c("SELECT COUNT(*) c FROM applications WHERE r1>=?", (R1_PASS,)), "r2_done": c("SELECT COUNT(*) c FROM applications WHERE r2 IS NOT NULL"),
                       "interview_done": c("SELECT COUNT(*) c FROM applications WHERE r3 IS NOT NULL"), "selected": c("SELECT COUNT(*) c FROM applications WHERE status='selected'")},
            "distribution": [sum(1 for t in tot if lo <= t < lo + 20 or (lo == 80 and t >= 80)) for lo in (0, 20, 40, 60, 80)]}

@app.exception_handler(Exception)
async def err(_, e): return JSONResponse({"detail": "Server error"}, status_code=500)
app.mount("/", StaticFiles(directory=FRONT, html=True), name="web")
