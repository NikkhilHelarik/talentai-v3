"use strict";
/* TalentAi - candidate + admin UI. Powered by Helarik (www.helarik.com). */
const root = document.getElementById("root"), toasts = document.getElementById("toasts");
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => (v == null ? "\u2013" : v + "%");
const ic = (n, c = "") => `<i class="fa-solid fa-${n} ${c}"></i>`;
const EMO_IC = { neutral: "face-meh", happy: "face-smile", sad: "face-frown", angry: "face-angry", fearful: "face-grimace", disgusted: "face-tired", surprised: "face-surprise" };
const emoIc = k => `<i class="fa-regular fa-${EMO_IC[k] || "face-meh"}"></i>`;
const KIND = { tab_switch: ["window-restore", "Tab change"], window_blur: ["up-right-from-square", "Window change"], fullscreen_exit: ["compress", "Left fullscreen"], no_face: ["user-slash", "Face not visible"], multiple_faces: ["users", "More than one person"],
  looking_away: ["eye-slash", "Looking away"], copy_paste: ["clipboard", "Copy / paste"], camera_off: ["video-slash", "Camera off"], device_detected: ["mobile-screen", "Smart device detected"], device_in_hand: ["hand-holding", "Device in hand"] };
const kindLbl = k => (KIND[k] || ["triangle-exclamation", String(k).replace(/_/g, " ")]);
let token = sessionStorage.getItem("t"), me = null;
const S = { mode: "login", page: "dash", open: null, menu: false, theme: localStorage.getItem("theme") || "dark", P: null, photo: "", photoDirty: false, cfg: { r1_pass: 60, r2_pass: 0, r1_questions: 20, r2_questions: 10, iv_questions: 15, r1_minutes: 30, r2_minutes: 30, max_violations: 6, tab_fail: 1 } };
function applyTheme() { document.documentElement.setAttribute("data-theme", S.theme); document.documentElement.setAttribute("data-bs-theme", S.theme); }
applyTheme();

/* ---------- brand ---------- */
const logo = h => `<span class="logo-plate"><img src="assets/logo.png" height="${h}" alt="TalentAi" style="height:${h}px;width:auto"></span>`;
const brandMini = () => logo(40);
const poweredBy = () => `<div class="pw-wrap"><a class="pw" href="https://www.helarik.com" target="_blank" rel="noopener noreferrer" title="Powered by Helarik \u2013 www.helarik.com"><img src="assets/powered-by-helarik.png" alt="Powered by Helarik" height="30"></a><div class="small text-muted mt-1">www.helarik.com</div></div>`;
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
const avatar = (photo, name, size = 40) => `<span class="avatar" style="--s:${size}px">${photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(name))}</span>`;

async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); throw new Error(d.detail || "Please login"); }
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Please check the values you entered");
  return d;
}
function toast(msg, type = "info", ms = 5500) {
  const d = document.createElement("div"), i = { success: "circle-check", danger: "circle-xmark", warning: "triangle-exclamation", info: "circle-info" }[type] || "circle-info";
  d.className = `glass toast-g ${type}`; d.innerHTML = `<i class="fa-solid fa-${i} t-ic"></i><span></span>`; d.lastChild.textContent = msg; toasts.appendChild(d); setTimeout(() => d.remove(), ms);
}
function askConfirm(title, html, ok = "Confirm") {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal-g";
    d.innerHTML = `<div class="glass p-4 modal-card" role="dialog" aria-modal="true"><h5 class="mb-2">${title}</h5><p class="text-muted">${html}</p><div class="d-flex gap-2 justify-content-end"><button class="btn btn-glass" data-v="0">Cancel</button><button class="btn btn-grad" data-v="1">${ok}</button></div></div>`;
    d.addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b || e.target === d) { d.remove(); res(b?.dataset.v === "1"); } });
    document.body.appendChild(d); d.querySelector(".btn-grad").focus();
  });
}
function logout() { sessionStorage.removeItem("t"); token = null; me = null; S.page = "dash"; S.open = null; render(); }
const stCls = s => ({ selected: "st-ok", rejected: "st-bad", awaiting: "st-warn", round1: "st-info", round2: "st-info", interview: "st-info", open: "st-ok", closed: "st-mut" }[s] || "st-mut");
const stLbl = s => ({ round1: "Assessment pending", round2: "Technical pending", interview: "Interview pending", awaiting: "Result awaited", selected: "Selected", rejected: "Not selected", open: "Open", closed: "Closed" }[s] || s);
const badge = s => `<span class="st ${stCls(s)}">${stLbl(s)}</span>`;
const chips = (s, mine) => String(s || "").split(",").filter(Boolean).map(x => `<span class="chip ${mine && mine.includes(x) ? "chip-on" : ""}">${esc(x)}</span>`).join("");
const bar = (l, v, inv) => v == null ? `<div class="small text-muted mb-2">${l}: n/a</div>` : `<div class="mb-2"><div class="meter"><span>${l}</span><b>${Math.round(v)}%</b></div><div class="bar ${(inv ? v > 50 : v < 50) ? "bad" : ""}"><i style="width:${Math.min(100, v)}%"></i></div></div>`;
const ring = (v, big) => `<div class="ring ${big ? "big" : ""}" style="--p:${v}" data-v="${v}%"></div>`;
const empty = (i, t, s = "") => `<div class="empty"><i class="fa-solid fa-${i}"></i><div class="fw-semibold">${t}</div>${s ? `<div class="small text-muted">${s}</div>` : ""}</div>`;

/* ---------- shell ---------- */
const NAV = { candidate: [["dash", "house", "Dashboard"], ["openings", "briefcase", "Openings"], ["apps", "chart-line", "My progress"], ["notes", "bell", "Messages"], ["profile", "user", "My profile"]], admin: [["dash", "chart-pie", "Overview"], ["openings", "briefcase", "Openings"], ["selected", "circle-check", "Selected"]] };
function shell(content, title) {
  return `<div class="shell"><div class="ov ${S.menu ? "show" : ""}" data-act="menu"></div>
  <aside class="side glass ${S.menu ? "open" : ""}"><div class="px-1 mb-3">${logo(44)}</div>
  <nav>${NAV[me.role].map(([k, i, l]) => `<a class="nv ${S.page === k && !S.open ? "on" : ""}" data-act="go" data-p="${k}" tabindex="0" role="button"><i class="fa-solid fa-${i} fa-fw"></i><span>${l}</span>${k === "notes" ? `<span id="nb" class="st st-bad ms-auto d-none"></span>` : ""}</a>`).join("")}</nav>
  <div class="mt-auto"><div class="text-center mb-3">${poweredBy()}</div><div class="glass p-3"><div class="d-flex align-items-center gap-2"><span id="sideav">${avatar(me.photo, me.name, 42)}</span><div class="min-w-0"><div class="fw-semibold text-truncate">${esc(me.name)}</div><div class="small text-muted text-truncate">${esc(me.email)}</div></div></div><button class="btn btn-glass btn-sm w-100 mt-2" data-act="logout">${ic("right-from-bracket", "me-1")}Logout</button></div></div></aside>
  <main class="main"><div class="topbar"><div class="d-flex align-items-center gap-2"><button class="btn btn-glass d-lg-none" data-act="menu" aria-label="Menu">${ic("bars")}</button><h4 class="mb-0">${title}</h4></div>
  <button class="btn btn-glass" data-act="theme" aria-label="Switch theme">${ic(S.theme === "dark" ? "sun" : "moon")}</button></div><div id="content" class="fx">${content}</div>
  <footer class="foot">&copy; ${new Date().getFullYear()} TalentAi &bull; Powered by <a href="https://www.helarik.com" target="_blank" rel="noopener noreferrer">Helarik</a> (www.helarik.com)</footer></main></div>`;
}
async function render() {
  stopPolls(); if (window.IV) IV.cleanup(); if (window.PR) PR.stop(); cleanupExam(); S.menu = false;
  if (S.page !== "profile") S.P = null;
  if (!me) return authView();
  root.innerHTML = shell(`<div class="skeleton mb-3"></div><div class="skeleton"></div>`, "Loading...");
  try { const p = me.role === "admin" ? await adminPage() : await candPage(); root.innerHTML = shell(p.html, p.title); startPolls(); }
  catch (e) { toast(e.message, "danger"); }
}
let pollT = null;
function stopPolls() { if (pollT) clearInterval(pollT); pollT = null; }
function startPolls() {
  if (me.role === "candidate") { pollNotes(); pollT = setInterval(pollNotes, 12000); }
  else pollT = setInterval(async () => { if (S.page === "dash" || S.open) { try { const p = await adminPage(); const c = $("#content"); if (c) c.innerHTML = p.html; } catch { } } }, 10000);
}
async function pollNotes() {
  try {
    const n = await api("/notifications"), un = n.filter(x => !x.read), b = $("#nb");
    if (b) { b.textContent = un.length; b.classList.toggle("d-none", !un.length); }
    if (S.lastUn !== undefined && un.length > S.lastUn) toast(un[0].msg, un[0].kind === "success" ? "success" : un[0].kind === "danger" ? "danger" : "info", 10000);
    S.lastUn = un.length;
  } catch { }
}

/* ---------- auth ---------- */
function authView() {
  const reg = S.mode === "register", feat = (i, t) => `<div class="feat">${ic(i)}<span>${t}</span></div>`;
  root.innerHTML = `<div class="hero fx"><div class="row w-100 align-items-center g-4" style="max-width:1100px">
  <div class="col-lg-7 px-lg-4"><div class="mb-4">${logo(92)}</div><h1 class="h2 fw-bold">Smart Hiring Process Using Talent AI </h1>
  <p class="text-muted fs-5 mb-4">AI-powered assessments, secure proctored interviews, real-time candidate monitoring, and intelligent recruitment analytics for smarter hiring decisions.</p>
  <div class="feats">${feat("stopwatch", "Timed rounds")}${feat("eye", "Eye &amp; face tracking")}${feat("mobile-screen", "Smart-device detection")}${feat("shield-halved", "Tab-change protection")}${feat("wand-magic-sparkles", "Auto selection")}</div></div>
  <div class="col-lg-5"><div class="glass p-4 mx-auto" style="max-width:440px"><ul class="nav nav-pills mb-3 gap-2"><li><a href="#" class="btn ${reg ? "btn-glass" : "btn-grad"}" data-act="mode" data-m="login">${ic("right-to-bracket", "me-1")}Login</a></li>
  <li><a href="#" class="btn ${reg ? "btn-grad" : "btn-glass"}" data-act="mode" data-m="register">${ic("user-plus", "me-1")}Register</a></li></ul>
  <form data-form="${S.mode}" autocomplete="on">${reg ? `<div class="input-ic"><i class="fa-solid fa-user"></i><input class="form-control" name="name" placeholder="Full name" required minlength="2" maxlength="80"></div>` : ""}
  <div class="input-ic"><i class="fa-solid fa-envelope"></i><input class="form-control" type="email" name="email" placeholder="Email" required maxlength="120"></div>
  <div class="input-ic"><i class="fa-solid fa-lock"></i><input class="form-control" type="password" name="password" id="pwd" placeholder="Password${reg ? " (min 8 characters)" : ""}" required minlength="${reg ? 8 : 1}" maxlength="128"><button type="button" class="pw-eye" data-act="togglepw" aria-label="Show password">${ic("eye")}</button></div>
  ${reg ? `<div class="input-ic"><i class="fa-solid fa-code"></i><input class="form-control" name="skills" placeholder="Skills e.g. python, sql, javascript" required maxlength="300"></div><div class="form-text mb-2">Tracks: python, javascript, sql, html, java</div>` : ""}
  <button class="btn btn-grad w-100 mt-2 py-2">${reg ? "Create account" : "Login"}</button></form></div></div></div>
  <div class="w-100 text-center mt-4">${poweredBy()}</div></div>`;
}

/* ---------- candidate ---------- */
const ICON_STEP = ["list-check", "laptop-code", "video"];
function stepper(a) {
  const c = S.cfg, ok = [a.r1 != null && a.r1 >= c.r1_pass, a.r2 != null && a.r2 >= c.r2_pass, a.r3 != null], v = [a.r1, a.r2, a.r3], act = ["round1", "round2", "interview"];
  const st = i => `<div class="step ${v[i] != null ? (ok[i] ? "done" : "fail") : a.status === act[i] ? "active" : ""}"><span class="dot">${ic(v[i] != null ? (ok[i] ? "check" : "xmark") : ICON_STEP[i])}</span><div>${["Assessment", "Technical", "AI interview"][i]}</div><b>${pct(v[i])}</b></div>`;
  return `<div class="steps">${st(0)}${st(1)}${st(2)}<div class="step ${a.status === "selected" ? "done" : a.status === "rejected" ? "fail" : ""}"><span class="dot">${ic("trophy")}</span><div>Result</div><b>${pct(a.total)}</b></div></div>`;
}
function appAction(m, oid) {
  if (!m) return `<button class="btn btn-grad" data-act="apply" data-id="${oid}">${ic("paper-plane", "me-2")}Apply and start assessment</button>`;
  const s = m.status;
  if (s === "round1" || s === "round2") return `<button class="btn btn-grad" data-act="round" data-id="${m.id}" data-n="${s === "round1" ? 1 : 2}">${ic("play", "me-2")}Continue ${s === "round1" ? "assessment (MCQ)" : "technical round"}</button>`;
  if (s === "interview") return `<button class="btn btn-grad" data-act="interview" data-id="${m.id}">${ic("video", "me-2")}Start AI live interview</button>`;
  if (s === "awaiting") return `<div class="st st-warn p-2 w-100">${ic("hourglass-half", "me-1")}You have completed all rounds. The result will be announced when the opening closes.</div>`;
  if (s === "selected") return `<div class="st st-ok p-2 w-100">${ic("trophy", "me-1")}You are selected! HR will contact you.</div>`;
  return `<div class="st st-mut p-2 w-100">${ic("lock", "me-1")}You have already attempted this opening and were not selected. Please try the next openings.</div>`;
}
async function candPage() {
  const p = S.page;
  if (p === "dash") {
    const [apps, ops, cfg] = await Promise.all([api("/my/applications"), api("/openings"), api("/config")]); S.cfg = cfg; me = await api("/me");
    const prog = a => ["round1", "round2", "interview"].includes(a.status), act = apps.find(prog), best = Math.max(0, ...apps.map(a => a.total || 0)), avail = ops.filter(o => !o.my && o.status === "open").length;
    const stat = (l, v, i) => `<div class="col-6 col-lg-3"><div class="glass stat"><span class="i">${ic(i)}</span><div class="v">${v}</div><div class="text-muted small">${l}</div></div></div>`;
    return { title: `Welcome, ${esc(me.name.split(" ")[0])}`, html: `<div class="row g-3 mb-3">${stat("Applications", apps.length, "file-lines")}${stat("In progress", apps.filter(prog).length, "hourglass-half")}${stat("Best total score", best ? best + "%" : "\u2013", "trophy")}${stat("Openings for you", avail, "briefcase")}</div>
    <div class="row g-3"><div class="col-lg-8"><div class="glass p-4 h-100"><h5>${act ? "Continue your application" : "Your journey"}</h5>${act ? `<h4 class="mt-2">${esc(act.title)}</h4><div class="my-3">${stepper(act)}</div>${appAction(act)}` :
      `<p class="text-muted">${avail ? `${avail} opening(s) match your skills.` : "No new openings right now."} Apply to start the assessment.</p><button class="btn btn-grad" data-act="go" data-p="openings">${ic("magnifying-glass", "me-2")}Browse openings</button>`}
      <hr><div class="small text-muted"><b>Rounds:</b> assessment (${cfg.r1_questions} questions, ${cfg.r1_minutes} min, minimum ${cfg.r1_pass}% to continue) &rarr; technical (${cfg.r2_questions} questions) &rarr; proctored AI live interview (${cfg.iv_questions} questions). All three scores decide the final ranking.<br>${ic("video", "me-1")}Every round is camera-proctored (face, eyes and smart devices). ${ic("window-restore", "ms-1 me-1")}Changing the tab or window fails the test.</div></div></div>
    <div class="col-lg-4"><div class="glass p-4 h-100 text-center"><h5>Profile strength</h5><div class="d-flex justify-content-center my-3">${ring(me.completeness, true)}</div>
      ${me.ready ? `<div class="st st-ok">${ic("circle-check", "me-1")}Ready to apply</div>` : `<div class="st st-warn mb-2">${ic("triangle-exclamation", "me-1")}Add photo, phone, city, education &amp; skills</div><br>`}<button class="btn btn-glass mt-2" data-act="go" data-p="profile">${ic("pen", "me-1")}Edit profile</button></div></div></div>` };
  }
  if (p === "openings") {
    const ops = await api("/openings"); me = await api("/me"); const mine = String(me.skills || "").split(",");
    return { title: "Openings matching your skills", html: (me.ready ? "" : `<div class="glass p-3 mb-3 st-warn">${ic("triangle-exclamation", "me-2")}Complete your profile (photo, phone, city, education, skills) to apply. <a href="#" data-act="go" data-p="profile">Open profile</a></div>`) +
      `<div class="row g-3">${ops.map(o => `<div class="col-md-6 col-xl-4"><div class="glass glass-hover p-4 h-100 d-flex flex-column"><div class="d-flex justify-content-between gap-2"><h5>${esc(o.title)}</h5>${badge(o.status)}</div>
      <div class="my-2">${chips(o.skills, mine)}</div><div class="small text-muted mb-3">${ic("users", "me-1")}${o.seats} opening(s)${o.deadline && o.status === "open" ? ` &bull; ${ic("clock", "me-1")}closes ${esc(new Date(o.deadline * 1000).toLocaleString())}` : ""}</div><div class="mt-auto">${appAction(o.my, o.id)}</div></div></div>`).join("") ||
      `<div class="col-12">${empty("briefcase", "No openings match your skills right now", "Update your skills in your profile or check again after new openings are added.")}</div>`}</div>` };
  }
  if (p === "apps") {
    const apps = await api("/my/applications");
    return { title: "My progress", html: apps.map(a => `<div class="glass p-4 mb-3"><div class="d-flex justify-content-between flex-wrap gap-2"><h5>${esc(a.title)}</h5>${badge(a.status)}</div><div class="my-3">${stepper(a)}</div>
      ${a.status === "rejected" ? `<div class="small text-muted mb-2">Sorry, you were not selected for this opening. Please try the next openings.</div>` : ""}
      ${["round1", "round2", "interview"].includes(a.status) ? appAction(a) : ""} ${a.r3 != null ? `<button class="btn btn-glass btn-sm" data-act="myreport" data-id="${a.id}">${ic("clipboard-list", "me-1")}View my report</button>` : ""}</div>`).join("") || empty("chart-line", "No applications yet", "Apply to an opening to see your progress here.") };
  }
  if (p === "notes") {
    const n = await api("/notifications"); api("/notifications/read", "POST").then(() => { const b = $("#nb"); if (b) b.classList.add("d-none"); S.lastUn = 0; });
    const NI = { success: "circle-check", danger: "circle-xmark", info: "circle-info" };
    return { title: "Messages", html: n.map(x => `<div class="glass p-3 mb-2 toast-g ${x.kind}"><i class="fa-solid fa-${NI[x.kind] || "circle-info"} t-ic"></i><div><div>${esc(x.msg)}</div><div class="small text-muted">${esc(new Date(x.created * 1000).toLocaleString())}</div></div></div>`).join("") || empty("bell", "No messages") };
  }
  const d = await api("/profile"); S.P = d.profile; S.P.education = S.P.education || []; S.P.experience = S.P.experience || []; S.P.skills = S.P.skills || ""; S.pemail = d.email; S.photo = d.photo || ""; S.photoDirty = false;
  return { title: "My profile", html: `<div class="row g-3"><div class="col-xl-8" id="pform">${profileForm()}</div><div class="col-xl-4"><div class="glass p-4" id="pv" style="position:sticky;top:14px">${profilePreview()}</div></div></div>` };
}

/* ---------- profile (photo, limits, live preview) ---------- */
const LIM = { full_name: 80, phone: 15, headline: 120, linkedin: 200, github: 200, address: 200, city: 60, state: 60, pincode: 10, country: 60, skills: 300, summary: 600, degree: 80, institute: 120, score: 20, company: 100, role: 100, desc: 400 };
const pin = (l, k, type = "text", col = "col-md-6", ph = "", req = false) => `<div class="${col}"><label class="form-label">${l}${req ? ` <span class="req">*</span>` : ""}</label><input class="form-control" data-p="${k}" type="${type}" maxlength="${LIM[k]}" value="${esc(S.P[k] || "")}" placeholder="${ph}" ${k === "phone" ? 'inputmode="tel"' : ""}></div>`;
function profileForm() {
  const P = S.P, li = (k, i, f, l, type = "text", col = "col-md-6") => `<div class="${col}"><label class="form-label">${l}</label><input class="form-control" data-pl="${k}" data-i="${i}" data-k="${f}" type="${type}" ${LIM[f] ? `maxlength="${LIM[f]}"` : ""} ${f === "year" ? 'min="1970" max="2040"' : ""} value="${esc(P[k][i][f] || "")}"></div>`;
  return `<div class="glass p-4 mb-3"><h5 class="mb-3">${ic("camera", "me-2 text-acc")}Profile photo <span class="req">*</span></h5><div class="d-flex align-items-center gap-4 flex-wrap"><div id="phbox">${avatar(S.photo, P.full_name, 112)}</div>
  <div class="flex-grow-1"><button class="btn btn-grad" data-act="pickphoto">${ic("upload", "me-2")}Upload or change photo</button><input type="file" id="photoIn" class="d-none" accept="image/jpeg,image/png,image/webp">
  <ul class="small text-muted mt-2 mb-0 ps-3"><li>JPG, PNG or WebP, up to <b>3 MB</b>, at least <b>200 &times; 200</b> pixels</li><li>A clear, front-facing photo of your face &ndash; no sunglasses or group photos</li><li>It is cropped to a square automatically and shown to recruiters</li></ul></div></div></div>
  <div class="glass p-4 mb-3"><h5 class="mb-3">${ic("id-card", "me-2 text-acc")}Personal &amp; contact</h5><div class="row g-2">${pin("Full name", "full_name", "text", "col-md-6", "", true)}${pin("Phone", "phone", "tel", "col-md-6", "+91 98765 43210", true)}${pin("Professional headline", "headline", "text", "col-12", "e.g. Python developer | 2 yrs experience")}${pin("LinkedIn", "linkedin", "text", "col-md-6", "linkedin.com/in/you")}${pin("GitHub", "github", "text", "col-md-6", "github.com/you")}</div></div>
  <div class="glass p-4 mb-3"><h5 class="mb-3">${ic("location-dot", "me-2 text-acc")}Address</h5><div class="row g-2"><div class="col-12"><label class="form-label">Street address</label><input class="form-control" data-p="address" maxlength="${LIM.address}" value="${esc(P.address || "")}"></div>${pin("City", "city", "text", "col-md-4", "", true)}${pin("State", "state", "text", "col-md-4")}${pin("Pincode", "pincode", "text", "col-md-4")}${pin("Country", "country", "text", "col-12")}</div></div>
  <div class="glass p-4 mb-3"><h5 class="mb-3">${ic("screwdriver-wrench", "me-2 text-acc")}Skills &amp; summary</h5><label class="form-label">Skills <span class="req">*</span> <span class="text-muted">(openings are shown by these)</span></label><input class="form-control mb-2" data-p="skills" maxlength="${LIM.skills}" value="${esc(P.skills || "")}" placeholder="python, sql, javascript, html, java">
  <label class="form-label">About you</label><textarea class="form-control" rows="3" maxlength="${LIM.summary}" data-p="summary">${esc(P.summary || "")}</textarea><div class="form-text text-end"><span id="cnt">${(P.summary || "").length}</span>/${LIM.summary}</div></div>
  <div class="glass p-4 mb-3"><div class="d-flex justify-content-between"><h5>${ic("graduation-cap", "me-2 text-acc")}Education <span class="req">*</span></h5><button class="btn btn-glass btn-sm" data-act="addedu">${ic("plus", "me-1")}Add</button></div>
  ${P.education.map((e, i) => `<div class="row g-2 mt-1 pb-2 row-sep" data-row="edu${i}">${li("education", i, "degree", "Degree (e.g. B.Tech CSE)")}${li("education", i, "institute", "College / University")}${li("education", i, "year", "Passing year", "number", "col-6 col-md-3")}${li("education", i, "score", "CGPA / %", "text", "col-6 col-md-3")}<div class="col-md-6 text-end align-self-end"><button class="btn btn-sm btn-outline-danger" data-act="deledu" data-i="${i}">${ic("trash", "me-1")}Remove</button></div></div>`).join("") || `<p class="text-muted mb-0 mt-2">Add at least one qualification.</p>`}</div>
  <div class="glass p-4 mb-3"><div class="d-flex justify-content-between"><h5>${ic("briefcase", "me-2 text-acc")}Experience</h5><button class="btn btn-glass btn-sm" data-act="addexp">${ic("plus", "me-1")}Add</button></div>
  ${P.experience.map((e, i) => `<div class="row g-2 mt-1 pb-2 row-sep" data-row="exp${i}">${li("experience", i, "company", "Company")}${li("experience", i, "role", "Role")}${li("experience", i, "start", "From", "month", "col-6 col-md-3")}${li("experience", i, "end", "To (blank = present)", "month", "col-6 col-md-3")}<div class="col-12"><label class="form-label">What did you do?</label><textarea class="form-control" rows="2" maxlength="${LIM.desc}" data-pl="experience" data-i="${i}" data-k="desc">${esc(e.desc || "")}</textarea></div><div class="col-12 text-end"><button class="btn btn-sm btn-outline-danger" data-act="delexp" data-i="${i}">${ic("trash", "me-1")}Remove</button></div></div>`).join("") || `<p class="text-muted mb-0 mt-2">Fresher? Skip this section.</p>`}</div>
  <div id="perr"></div><button class="btn btn-grad px-4 py-2" data-act="saveprofile">${ic("floppy-disk", "me-2")}Save profile</button>`;
}
const validEdu = P => P.education.filter(e => e.degree && e.degree.trim().length > 1 && e.institute && e.institute.trim().length > 1 && +e.year >= 1970 && +e.year <= 2040);
const validExp = P => P.experience.filter(e => (e.company || "").trim() && (e.role || "").trim());
function comp(P) { const keys = ["full_name", "phone", "address", "city", "state", "country", "pincode", "headline", "summary", "skills"]; return Math.round((keys.filter(k => String(P[k] || "").trim()).length + (S.photo ? 1 : 0) + (validEdu(P).length ? 3 : 0) + (validExp(P).length ? 2 : 0)) / 16 * 100); }
function expYears(P) {
  let m = 0; const now = new Date(), cur = now.getFullYear() * 12 + now.getMonth();
  validExp(P).forEach(e => { if (!e.start) return; const [sy, sm] = e.start.split("-").map(Number), s = sy * 12 + sm - 1; const en = e.end ? (() => { const [ey, em] = e.end.split("-").map(Number); return ey * 12 + em - 1; })() : cur; if (en >= s) m += en - s + 1; });
  return (m / 12).toFixed(1);
}
function profilePreview() {
  const P = S.P, c = comp(P), tick = (ok, t) => `<div class="small">${ic(ok ? "circle-check" : "circle", ok ? "text-success" : "text-muted")} ${t}</div>`;
  return `<div class="d-flex align-items-center gap-3 mb-3">${avatar(S.photo, P.full_name, 72)}<div class="min-w-0"><div class="fw-bold fs-5 text-truncate">${esc(P.full_name || "Your name")}</div><div class="small text-muted">${esc(P.headline || "Headline")}</div></div></div>
  <div class="d-flex align-items-center gap-3">${ring(c)}<div>${tick(S.photo, "Photo")}${tick(P.phone, "Phone")}${tick(P.city, "City")}${tick(validEdu(P).length, "Education")}${tick(P.skills, "Skills")}</div></div><hr>
  <div class="small">${ic("envelope", "me-2 text-muted")}${esc(S.pemail)}<br>${ic("phone", "me-2 text-muted")}${esc(P.phone || "\u2013")}<br>${ic("location-dot", "me-2 text-muted")}${esc([P.address, P.city, P.state, P.pincode, P.country].filter(Boolean).join(", ") || "\u2013")}</div><div class="my-2">${chips(String(P.skills || "").split(",").map(x => x.trim()).join(","))}</div>
  ${validEdu(P).map(e => `<div class="small">${ic("graduation-cap", "me-2 text-muted")}<b>${esc(e.degree)}</b>, ${esc(e.institute)} (${esc(e.year)}) ${esc(e.score || "")}</div>`).join("")}
  ${validExp(P).length ? `<div class="small mt-2">${ic("briefcase", "me-2 text-muted")}Experience: <b>${expYears(P)} yrs</b></div>` : ""}${validExp(P).map(e => `<div class="small">&bull; ${esc(e.role)} @ ${esc(e.company)}</div>`).join("")}`;
}
async function pickPhoto(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast("Photo must be a JPG, PNG or WebP image", "danger");
  if (file.size > 3 * 1024 * 1024) return toast("Photo is too large \u2013 the maximum is 3 MB", "danger");
  const url = URL.createObjectURL(file), img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
  if (!img) { URL.revokeObjectURL(url); return toast("This image could not be read \u2013 choose another photo", "danger"); }
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  if (s < 200) { URL.revokeObjectURL(url); return toast("Photo is too small \u2013 use at least 200 \u00d7 200 pixels", "danger"); }
  const c = document.createElement("canvas"); c.width = c.height = 320; c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 320, 320); URL.revokeObjectURL(url);
  S.photo = c.toDataURL("image/jpeg", 0.86); S.photoDirty = true;
  const b = $("#phbox"); if (b) b.innerHTML = avatar(S.photo, S.P.full_name, 112); const pv = $("#pv"); if (pv) pv.innerHTML = profilePreview(); toast("Photo ready \u2013 click Save profile to keep it", "info", 3500);
}
function validateProfile(P) {
  const e = [], t = k => String(P[k] || "").trim();
  if (!S.photo) e.push({ k: "photo", msg: "Upload your profile photo" });
  if (t("full_name").length < 2) e.push({ k: "full_name", msg: "Enter your full name (at least 2 characters)" });
  if (!/^[0-9+\-\s]{7,15}$/.test(t("phone"))) e.push({ k: "phone", msg: "Enter a valid phone number (7\u201315 characters: digits, +, - and spaces)" });
  if (!t("city")) e.push({ k: "city", msg: "Enter your city" });
  if (t("pincode") && !/^[0-9A-Za-z\- ]{3,10}$/.test(t("pincode"))) e.push({ k: "pincode", msg: "Pincode must be 3\u201310 letters or digits" });
  if (!t("skills")) e.push({ k: "skills", msg: "Add at least one skill (comma separated)" });
  P.education.forEach((x, i) => {
    if (!(x.degree || x.institute || x.year || x.score)) return; const bad = [];
    if ((x.degree || "").trim().length < 2) bad.push("degree"); if ((x.institute || "").trim().length < 2) bad.push("college"); if (!(+x.year >= 1970 && +x.year <= 2040)) bad.push("passing year (1970\u20132040)");
    if (bad.length) e.push({ k: "edu" + i, msg: `Education #${i + 1}: check ${bad.join(", ")}` });
  });
  if (!validEdu(P).length && !e.some(x => x.k.startsWith("edu"))) e.push({ k: "education", msg: "Add at least one complete qualification (degree, college, year)" });
  P.experience.forEach((x, i) => {
    if (!(x.company || x.role || x.start || x.end || x.desc)) return;
    if (!(x.company || "").trim() || !(x.role || "").trim()) e.push({ k: "exp" + i, msg: `Experience #${i + 1}: company and role are required` });
    else if (x.start && x.end && x.end < x.start) e.push({ k: "exp" + i, msg: `Experience #${i + 1}: the end date is before the start date` });
  });
  return e;
}
function showErrors(errs) {
  document.querySelectorAll(".is-invalid").forEach(x => x.classList.remove("is-invalid"));
  errs.forEach(({ k }) => { document.querySelectorAll(k === "photo" ? "#phbox" : k.startsWith("edu") || k.startsWith("exp") ? `[data-row="${k}"] input` : `[data-p="${k}"]`).forEach(x => x.classList.add("is-invalid")); });
  const b = $("#perr"); if (b) b.innerHTML = errs.length ? `<div class="alert-g mb-3" role="alert"><b>${ic("triangle-exclamation", "me-2")}Please fix the following:</b><ul class="mb-0 mt-1">${errs.map(x => `<li>${esc(x.msg)}</li>`).join("")}</ul></div>` : "";
  if (errs.length) { b?.scrollIntoView({ behavior: "smooth", block: "center" }); toast(errs[0].msg, "warning"); }
}
document.addEventListener("input", e => {
  const t = e.target; if (!S.P) return; t.classList.remove("is-invalid");
  if (t.dataset.p) S.P[t.dataset.p] = t.value; else if (t.dataset.pl) S.P[t.dataset.pl][+t.dataset.i][t.dataset.k] = t.value; else return;
  if (t.dataset.p === "summary") { const c = $("#cnt"); if (c) c.textContent = t.value.length; }
  const pv = $("#pv"); if (pv) pv.innerHTML = profilePreview();
});
document.addEventListener("change", e => { if (e.target.id === "photoIn") { pickPhoto(e.target.files[0]); e.target.value = ""; } });

/* ---------- proctored timed exam (assessment & technical round) ---------- */
const EX = { cleanup() { } };
function cleanupExam() { EX.cleanup(); EX.cleanup = () => { }; }
async function openRound(aid, n) {
  cleanupExam(); S.cfg = await api("/config"); const c = S.cfg, cnt = n === 1 ? c.r1_questions : c.r2_questions, mins = n === 1 ? c.r1_minutes : c.r2_minutes;
  PR.lobby({ title: n === 1 ? "Assessment \u2013 system check" : "Technical round \u2013 system check", sub: `${cnt} questions &bull; <b>${mins} minutes</b> &bull; the timer starts when you press the start button`, audio: false, emotions: false, maxV: c.max_violations, tabFail: c.tab_fail,
    beginText: n === 1 ? "Start assessment" : "Start technical round", rules: [n === 1 ? `Minimum <b>${c.r1_pass}%</b> is needed to reach the next round. Questions are multiple choice.` : `Write clear answers with examples. Answers are scored on the concepts you cover.`], onBegin: () => startRound(aid, n) });
}
async function startRound(aid, n) {
  const d = await api(`/round/${aid}/${n}`); cleanupExam(); const mcq = n === 1;
  Object.assign(EX, { aid, n, qs: d.questions, end: Date.now() + d.seconds_left * 1000, done: false });
  root.innerHTML = `<div class="container-xl py-3 fx"><div class="glass exam-bar"><div><b>${esc(d.title)}</b><div class="small text-muted">${mcq ? `Assessment &bull; ${d.questions.length} questions &bull; minimum ${d.pass_mark}% to reach the next round` : `Technical round &bull; ${d.questions.length} questions`}</div></div>
  <div class="d-flex align-items-center gap-3"><span class="timer" id="tm">--:--</span><button class="btn btn-grad" data-act="submitround">${ic("paper-plane", "me-2")}Submit</button></div></div>
  <div class="row g-3 mt-1"><div class="col-lg-9 order-2 order-lg-1" id="qs" ${mcq ? 'style="user-select:none"' : ""}>${d.questions.map((q, i) => `<div class="glass p-4 mb-3 qcard" id="qc${i}"><div class="d-flex gap-3"><span class="qno">${i + 1}</span><b class="flex-grow-1">${esc(q.q)}</b></div><div class="mt-3">${mcq ? q.o.map((o, j) => `<label class="opt"><input type="radio" name="q${q.id}" value="${j}">${esc(o)}</label>`).join("") :
    `<textarea class="form-control" name="q${q.id}" rows="5" maxlength="2000" placeholder="Write a clear answer (explain concepts, mention examples)"></textarea>`}</div></div>`).join("")}
  <div class="text-center mb-3"><button class="btn btn-grad px-5 py-2" data-act="submitround">${ic("paper-plane", "me-2")}Submit ${mcq ? "assessment" : "round"}</button></div></div>
  <div class="col-lg-3 order-1 order-lg-2"><div class="exam-side"><div class="glass p-2 mb-3">${PR.camHTML()}</div>
  <div class="glass p-3 mb-3"><div class="d-flex justify-content-between align-items-center"><b>Warnings</b><span class="st st-ok" id="vc">0/${d.max_violations}</span></div><div class="small text-muted mt-2">${ic("window-restore", "me-1")}Changing tab or window ${d.tab_fail === 1 ? "<b>fails the test</b>" : `<b>x${d.tab_fail}</b> fails the test`}</div></div>
  <div class="glass p-3"><div class="d-flex justify-content-between mb-2"><b>Questions</b><span class="small text-muted"><span id="ans">0</span>/${d.questions.length} answered</span></div><div class="palette">${d.questions.map((q, i) => `<button class="qp" id="qp${i}" data-act="goq" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`).join("")}</div></div></div></div></div>${poweredBy()}</div>`;
  const tick = () => { const r = Math.max(0, Math.round((EX.end - Date.now()) / 1000)); const t = $("#tm"); if (t) { t.textContent = String(Math.floor(r / 60)).padStart(2, "0") + ":" + String(r % 60).padStart(2, "0"); t.classList.toggle("low", r <= 60); } if (r <= 0) submitRound(true); };
  tick(); const iv = setInterval(tick, 1000);
  const ansd = q => mcq ? !!document.querySelector(`input[name="q${q.id}"]:checked`) : !!(document.querySelector(`textarea[name="q${q.id}"]`) || {}).value?.trim();
  const count = () => { let k = 0; EX.qs.forEach((q, i) => { const a = ansd(q); if (a) k++; document.getElementById("qp" + i)?.classList.toggle("done", a); }); const a = $("#ans"); if (a) a.textContent = k; };
  document.addEventListener("input", count); document.addEventListener("change", count); EX.unanswered = () => EX.qs.filter(q => !ansd(q)).length;
  EX.cleanup = () => { clearInterval(iv); document.removeEventListener("input", count); document.removeEventListener("change", count); };
  PR.run({ aid, rnd: n, emotions: false, onCounter: r => { const v = $("#vc"); if (v) { v.textContent = `${r.soft ?? r.violations}/${r.limit}`; v.className = "st " + ((r.soft ?? 0) >= r.limit - 1 ? "st-bad" : "st-warn"); } }, onFail: msg => { EX.done = true; cleanupExam(); PR.stop(); resultView({ passed: false, message: msg }); } });
}
async function submitRound(auto) {
  if (EX.done) return; EX.done = true; const { aid, n, qs } = EX, answers = {}; qs.forEach(q => { if (n === 1) { const c = document.querySelector(`input[name="q${q.id}"]:checked`); answers[q.id] = c ? +c.value : -1; } else { const t = document.querySelector(`textarea[name="q${q.id}"]`); answers[q.id] = t ? t.value : ""; } });
  cleanupExam(); PR.stop();
  try { const r = await api(`/round/${n}/${aid}`, "POST", { answers }); if (auto) r.message = "Time is up \u2013 your answers were submitted automatically. " + r.message; resultView(r); }
  catch (e) { toast(e.message, "danger"); S.page = "dash"; render(); }
}
function resultView(r) {
  root.innerHTML = `<div class="hero fx"><div class="glass p-5 text-center" style="max-width:580px"><div class="res-ic ${r.passed ? "ok" : "bad"}">${ic(r.passed ? "circle-check" : "circle-xmark")}</div><h4 class="my-3">${esc(r.message)}</h4>
  ${r.total != null ? `<div class="d-flex justify-content-center my-3">${ring(Math.round(r.total), true)}</div>` : ""}<button class="btn btn-grad px-4" data-act="home">${ic("house", "me-2")}Back to dashboard</button><div class="mt-4">${poweredBy()}</div></div></div>`;
}

/* ---------- report + proctor log ---------- */
function eventsTable(ev) {
  if (!ev || !ev.length) return `<div class="small text-muted">${ic("circle-check", "text-success me-1")}No proctoring events were recorded.</div>`;
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Time</th><th>Round</th><th>Event</th><th>Detail</th></tr></thead><tbody>${ev.map(e => { const [i, l] = kindLbl(e.kind); return `<tr><td class="small text-nowrap">${esc(new Date(e.created * 1000).toLocaleString())}</td><td>${["", "Assessment", "Technical", "Interview"][e.rnd] || e.rnd}</td><td><span class="st ${e.kind === "tab_switch" || e.kind === "window_blur" ? "st-bad" : "st-warn"}">${ic(i, "me-1")}${esc(l)}</span></td><td class="small text-muted">${esc(e.detail)}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function reportView(r, back, adminView) {
  const i = r.interview, c = i.communication, v = i.vision, pr = r.proctoring, P = r.profile;
  const emo = v ? Object.entries(v.emotions).sort((a, b) => b[1] - a[1]).map(([k, x]) => `<div class="emo-row"><span>${emoIc(k)} ${k}</span><div class="bar"><i style="width:${x}%"></i></div><span style="width:40px;text-align:right">${x}%</span></div>`).join("") : "";
  const body = `<div class="container py-3 fx" style="max-width:1100px"><button class="btn btn-glass mb-3" data-act="${back}">${ic("arrow-left", "me-2")}Back</button><div class="d-flex align-items-center gap-3 mb-3 flex-wrap">${adminView && P ? avatar(P.photo, P.full_name, 84) : ""}${ring(Math.round(r.total), true)}<div><h3 class="mb-0">${esc(r.title || "Assessment report")}</h3><div class="text-muted">${adminView && P ? esc(P.full_name) + " &bull; " : ""}Weighted total score</div></div></div>
  <div class="row g-3"><div class="col-md-6 col-xl-3"><div class="glass p-3 h-100"><h6>${ic("chart-simple", "me-1")}Scores</h6>${bar("Assessment", r.round1)}${bar("Technical", r.round2)}${bar("AI interview", r.round3)}</div></div>
  <div class="col-md-6 col-xl-3"><div class="glass p-3 h-100"><h6>${ic("comments", "me-1")}Communication</h6>${bar("Overall", c.score)}${bar("Fluency", c.fluency)}${bar("Speaking pace", c.pace)}${bar("Completeness", c.completeness)}<div class="small text-muted">${c.avg_wpm ?? "n/a"} wpm &bull; ${c.filler_words} fillers &bull; ${c.total_words} words</div></div></div>
  <div class="col-md-6 col-xl-3"><div class="glass p-3 h-100"><h6>${ic("brain", "me-1")}AI vision</h6>${v ? `${bar("Confidence", v.confidence)}${bar("Eye contact", v.eye_contact)}${bar("Nervousness", v.nervousness, true)}${bar("Head stability", v.stability)}<div class="small text-muted">Dominant mood: ${emoIc(v.dominant)} ${v.dominant}<br>Eyes off-screen ${v.eye_off_pct ?? 0}% &bull; Device seen ${v.device_pct ?? 0}% &bull; In hand ${v.hand_pct ?? 0}%</div>` : `<div class="text-muted small">Camera AI was unavailable.</div>`}</div></div>
  <div class="col-md-6 col-xl-3"><div class="glass p-3 h-100"><h6>${ic("shield-halved", "me-1")}Proctoring</h6>${bar("Discipline", i.discipline)}<div class="small">${pr.total_all_rounds ?? pr.violations} violation(s) in all rounds</div>${Object.entries(pr.by_round || {}).map(([rn, ks]) => `<div class="small text-muted"><b>${["", "Assessment", "Technical", "Interview"][rn]}:</b> ${Object.entries(ks).map(([k, n]) => `${esc(kindLbl(k)[1])} ${n}`).join(", ")}</div>`).join("")}</div></div></div>
  ${v ? `<div class="glass p-3 mt-3"><h6>Emotion distribution (average across the interview)</h6>${emo}</div>` : ""}
  <div class="row g-3 mt-1"><div class="col-md-6"><div class="glass p-3 h-100"><h6>${ic("thumbs-up", "me-1 text-success")}Strengths</h6><ul class="mb-0">${i.strengths.map(x => `<li>${esc(x)}</li>`).join("") || "<li>\u2013</li>"}</ul></div></div><div class="col-md-6"><div class="glass p-3 h-100"><h6>${ic("arrow-trend-up", "me-1 text-warning")}Areas to improve</h6><ul class="mb-0">${i.improvements.map(x => `<li>${esc(x)}</li>`).join("") || "<li>\u2013</li>"}</ul></div></div></div>
  ${adminView && P ? `<div class="glass p-3 mt-3"><h6>${ic("id-card", "me-1")}Candidate profile</h6><div class="small">${esc(P.full_name)} &bull; ${esc(P.email)} &bull; ${esc(P.phone || "\u2013")}<br>${esc([P.address, P.city, P.state, P.pincode, P.country].filter(Boolean).join(", "))}<br>Skills: ${esc(P.skills)}<br>${(P.education || []).map(e => `${ic("graduation-cap", "me-1")}${esc(e.degree)}, ${esc(e.institute)} (${esc(e.year)}) ${esc(e.score || "")}`).join("<br>")}<br>${(P.experience || []).map(e => `${ic("briefcase", "me-1")}${esc(e.role)} @ ${esc(e.company)} ${esc(e.start)}\u2013${esc(e.end || "now")}`).join("<br>")}</div></div>` : ""}
  ${adminView && r.events ? `<div class="glass p-3 mt-3"><h6>${ic("list", "me-1")}Proctoring log</h6>${eventsTable(r.events)}</div>` : ""}
  <h6 class="mt-4">Interview transcript &amp; per-question metrics</h6>${i.per_question.map((q, k) => `<div class="glass p-3 mb-2"><b>Q${k + 1}. ${esc(q.question)}</b><p class="mb-1 mt-2">${esc(q.transcript) || "<i class='text-muted'>(no answer)</i>"}</p><div class="small text-muted">Relevance ${q.relevance}% &bull; Fluency ${q.fluency}% &bull; Pace ${q.pace ?? "n/a"} &bull; Completeness ${q.completeness}%${q.confidence != null ? ` &bull; Confidence ${q.confidence}% ${q.emotion ? emoIc(q.emotion) : ""}` : ""}</div></div>`).join("")}
  <div class="glass p-3 small text-muted mt-3">${esc(r.note)}</div>${poweredBy()}</div>`;
  root.innerHTML = body;
}
function logView(d) {
  root.innerHTML = `<div class="container py-3 fx" style="max-width:960px"><button class="btn btn-glass mb-3" data-act="back">${ic("arrow-left", "me-2")}Back</button><div class="d-flex align-items-center gap-3 mb-3">${avatar(d.photo, d.name, 64)}<div><h4 class="mb-0">${esc(d.name)}</h4><div class="text-muted small">${esc(d.email)} &bull; ${esc(d.title)} &bull; ${badge(d.status)}</div></div></div>
  <div class="glass p-3"><h6>${ic("list", "me-1")}Proctoring log (${d.events.length} event${d.events.length === 1 ? "" : "s"})</h6>${eventsTable(d.events)}</div>${poweredBy()}</div>`;
}

/* ---------- admin ---------- */
async function adminPage() {
  if (S.open) return adminCands(S.open);
  const p = S.page;
  if (p === "dash") {
    const o = await api("/admin/overview"), f = o.funnel, mx = Math.max(1, f.applied), d = o.distribution, dm = Math.max(1, ...d);
    const stat = (l, v, i) => `<div class="col-6 col-xl-3"><div class="glass stat"><span class="i">${ic(i)}</span><div class="v">${v}</div><div class="text-muted small">${l}</div></div></div>`;
    const fr = (l, v) => `<div class="mb-2"><div class="meter"><span>${l}</span><b>${v}</b></div><div class="bar"><i style="width:${v / mx * 100}%"></i></div></div>`;
    return { title: `Overview <span class="st st-ok ms-2" style="font-size:.65rem">${ic("circle", "me-1")}LIVE</span>`, html: `<div class="row g-3 mb-3">${stat("Total openings", o.openings, "briefcase")}${stat("Open now", o.open, "door-open")}${stat("Registered candidates", o.candidates, "users")}${stat("Selected", o.selected, "user-check")}</div>
    <div class="row g-3"><div class="col-lg-6"><div class="glass p-4 h-100"><h5>Hiring funnel</h5>${fr("Applied", f.applied)}${fr("Assessment attempted", f.r1_attempted)}${fr("Cleared assessment", f.r1_cleared)}${fr("Technical done", f.r2_done)}${fr("Interview done", f.interview_done)}${fr("Selected", f.selected)}</div></div>
    <div class="col-lg-6"><div class="glass p-4 h-100"><h5>Total score distribution</h5><div class="dist mt-4">${d.map((n, i) => `<div><i style="height:${n / dm * 100}px"></i>${n}<br>${i * 20}\u2013${i * 20 + 20}</div>`).join("")}</div></div></div></div>` };
  }
  if (p === "openings") {
    const ops = await api("/admin/openings");
    return { title: "Openings", html: `<div class="glass p-4 mb-3"><h5>${ic("circle-plus", "me-2 text-acc")}Add opening</h5><form data-form="opening" class="row g-2"><div class="col-md-4"><input class="form-control" name="title" placeholder="Position title" required maxlength="100"></div>
    <div class="col-md-3"><input class="form-control" name="skills" placeholder="Skills: python, sql" maxlength="200"></div><div class="col-6 col-md-2"><input class="form-control" type="number" name="seats" min="1" placeholder="Openings" required></div>
    <div class="col-6 col-md-2"><input class="form-control" type="number" name="deadline_hours" min="0.1" step="any" placeholder="Auto-close (hrs)"></div><div class="col-md-1"><button class="btn btn-grad w-100" aria-label="Add opening">${ic("plus")}</button></div></form>
    <div class="form-text mt-2">When the time ends the top scorers (up to the number of openings) are selected automatically. Leave time empty to close manually.</div></div>
    <div class="row g-3">${ops.map(o => `<div class="col-md-6 col-xl-4"><div class="glass glass-hover p-4 h-100"><div class="d-flex justify-content-between"><h5>${esc(o.title)}</h5>${badge(o.status)}</div><div class="my-2">${chips(o.skills)}</div>
    <div class="small mb-3">Openings <b>${o.seats}</b> &bull; Applicants <b>${o.counts.applicants}</b><br>In progress ${o.counts.in_progress} &bull; Completed ${o.counts.awaiting} &bull; Selected <b class="text-success">${o.counts.selected}</b> &bull; Rejected ${o.counts.rejected}
    ${o.deadline && o.status === "open" ? `<br><span class="text-muted">${ic("clock", "me-1")}Auto-closes ${esc(new Date(o.deadline * 1000).toLocaleString())}</span>` : ""}</div>
    <button class="btn btn-grad btn-sm" data-act="cands" data-id="${o.id}">${ic("ranking-star", "me-1")}Candidates &amp; scores</button> ${o.status === "open" ? `<button class="btn btn-glass btn-sm" data-act="finalize" data-id="${o.id}">Select top ${o.seats} now</button>` : ""}</div></div>`).join("") || `<div class="col-12">${empty("briefcase", "No openings yet", "Add your first opening above.")}</div>`}</div>` };
  }
  const s = await api("/admin/selected");
  return { title: "Selected candidates", html: `<div class="glass p-3"><div class="table-responsive"><table class="table align-middle mb-0"><thead><tr><th>Candidate</th><th>Opening</th><th>Contact</th><th>Rank</th><th>Total</th><th></th></tr></thead><tbody>${s.map(x => `<tr><td><div class="d-flex align-items-center gap-2">${avatar(x.photo, x.name, 36)}${esc(x.name)}</div></td><td>${esc(x.title)}</td><td class="small">${esc(x.email)}<br>${esc(x.phone || "")}</td><td>#${x.rank}</td><td><b>${x.total}%</b></td><td><button class="btn btn-glass btn-sm" data-act="areport" data-id="${x.id}">${ic("clipboard-list", "me-1")}Report</button></td></tr>`).join("") || `<tr><td colspan="6">${empty("user-check", "No selections yet")}</td></tr>`}</tbody></table></div></div>` };
}
async function adminCands(oid) {
  const [ops, cs] = await Promise.all([api("/admin/openings"), api(`/admin/openings/${oid}/candidates`)]); const o = ops.find(x => x.id == oid), sel = cs.filter(c => c.status === "selected");
  const table = list => `<div class="table-responsive"><table class="table align-middle mb-0"><thead><tr><th>#</th><th>Candidate</th><th>Assess.</th><th>Tech</th><th>Interview</th><th>Total</th><th title="Proctoring violations">${ic("triangle-exclamation")}</th><th>Status</th><th></th></tr></thead><tbody>${list.map((c, i) => `<tr><td>${c.rank ?? i + 1}</td><td><div class="d-flex align-items-center gap-2">${avatar(c.photo, c.name, 38)}<div>${esc(c.name)}<div class="small text-muted">${esc(c.email)}</div></div></div></td><td>${pct(c.r1)}</td><td>${pct(c.r2)}</td><td>${pct(c.r3)}</td><td><b>${pct(c.total)}</b></td><td>${c.violations ? `<span class="st st-warn">${c.violations}</span>` : 0}</td><td>${badge(c.status)}</td><td class="text-nowrap">${c.r3 != null ? `<button class="btn btn-glass btn-sm" data-act="areport" data-id="${c.id}">${ic("clipboard-list", "me-1")}Report</button> ` : ""}${c.violations ? `<button class="btn btn-glass btn-sm" data-act="alog" data-id="${c.id}">${ic("list", "me-1")}Log</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="text-muted">None yet</td></tr>`}</tbody></table></div>`;
  return { title: esc(o.title), html: `<button class="btn btn-glass mb-3" data-act="adminback">${ic("arrow-left", "me-2")}All openings</button> ${badge(o.status)} <span class="text-muted ms-2">${o.seats} opening(s)</span> ${o.status === "open" ? `<button class="btn btn-grad btn-sm ms-2" data-act="finalize" data-id="${o.id}">Select top ${o.seats} now</button>` : ""}
  <div class="glass p-3 mt-3"><h5>${ic("circle-check", "me-2 text-success")}Selected (${sel.length})</h5>${table(sel)}</div><div class="glass p-3 mt-3"><h5>All candidates by total score</h5>${table(cs)}</div>` };
}

/* ---------- events (CSP safe: no inline handlers) ---------- */
const acts = {
  back: () => render(), logout, menu: () => { S.menu = !S.menu; document.querySelector(".side")?.classList.toggle("open", S.menu); document.querySelector(".ov")?.classList.toggle("show", S.menu); },
  theme: () => { S.theme = S.theme === "dark" ? "light" : "dark"; localStorage.setItem("theme", S.theme); applyTheme(); render(); },
  go: d => { S.page = d.p; S.open = null; render(); }, home: () => { S.page = "dash"; S.open = null; render(); },
  mode: d => { S.mode = d.m; authView(); },
  togglepw: () => { const i = $("#pwd"); if (!i) return; i.type = i.type === "password" ? "text" : "password"; document.querySelector(".pw-eye").innerHTML = ic(i.type === "password" ? "eye" : "eye-slash"); },
  apply: async d => { const r = await api(`/apply/${d.id}`, "POST"); openRound(r.application_id, 1); },
  round: d => openRound(d.id, +d.n),
  submitround: async () => { const u = EX.unanswered ? EX.unanswered() : 0; if (await askConfirm("Submit this round?", u ? `You have <b>${u}</b> unanswered question${u > 1 ? "s" : ""}. Unanswered questions score zero.` : "All questions are answered. You cannot change your answers after submitting.", "Submit now")) submitRound(false); },
  goq: d => document.getElementById("qc" + d.i)?.scrollIntoView({ behavior: "smooth", block: "center" }),
  interview: d => IV.start(d.id),
  myreport: async d => reportView(await api(`/my/applications/${d.id}/report`), "home", false),
  cands: d => { S.open = d.id; render(); }, adminback: () => { S.open = null; render(); },
  areport: async d => reportView(await api(`/admin/applications/${d.id}/report`), "back", true),
  alog: async d => logView(await api(`/admin/applications/${d.id}/events`)),
  finalize: async d => { if (!(await askConfirm("Close this opening?", "The top candidates are selected and everyone is notified automatically.", "Select and close"))) return; const r = await api(`/admin/openings/${d.id}/finalize`, "POST"); toast(`${r.selected} candidate(s) selected and notified.`, "success"); render(); },
  pickphoto: () => $("#photoIn")?.click(),
  addedu: () => { S.P.education.push({ degree: "", institute: "", year: "", score: "" }); $("#pform").innerHTML = profileForm(); },
  addexp: () => { S.P.experience.push({ company: "", role: "", start: "", end: "", desc: "" }); $("#pform").innerHTML = profileForm(); },
  deledu: d => { S.P.education.splice(+d.i, 1); $("#pform").innerHTML = profileForm(); $("#pv").innerHTML = profilePreview(); },
  delexp: d => { S.P.experience.splice(+d.i, 1); $("#pform").innerHTML = profileForm(); $("#pv").innerHTML = profilePreview(); },
  saveprofile: async () => {
    const P = S.P, errs = validateProfile(P); showErrors(errs); if (errs.length) return;
    const body = { ...P, photo: S.photoDirty ? S.photo : undefined, education: validEdu(P).map(e => ({ degree: e.degree.trim(), institute: e.institute.trim(), year: +e.year, score: (e.score || "").trim() })), experience: validExp(P).map(e => ({ company: e.company.trim(), role: e.role.trim(), start: e.start || "", end: e.end || "", desc: e.desc || "" })) };
    const r = await api("/profile", "PUT", body); S.photoDirty = false; me = await api("/me"); const sa = $("#sideav"); if (sa) sa.innerHTML = avatar(me.photo, me.name, 42);
    toast(r.missing.length ? `Saved. Still missing: ${r.missing.join(", ")}` : "Profile saved \u2013 you are ready to apply!", r.missing.length ? "warning" : "success");
  },
};
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return; if (b.tagName !== "INPUT") e.preventDefault();
  try { await acts[b.dataset.act]?.(b.dataset); } catch (err) { toast(err.message, "danger"); }
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("a.nv")) { e.preventDefault(); e.target.click(); } });
const forms = {
  login: async d => { await boot((await api("/login", "POST", d)).token); }, register: async d => { await boot((await api("/register", "POST", d)).token); },
  opening: async d => { await api("/admin/openings", "POST", { title: d.title, skills: d.skills, seats: +d.seats, deadline_hours: d.deadline_hours ? +d.deadline_hours : null }); toast("Opening added \u2013 matching candidates can see it now.", "success"); render(); },
};
document.addEventListener("submit", async e => { const f = e.target.dataset.form; if (!f) return; e.preventDefault(); try { await forms[f](Object.fromEntries(new FormData(e.target))); } catch (err) { toast(err.message, "danger"); } });
async function boot(t) { token = t; sessionStorage.setItem("t", t); me = await api("/me"); S.page = "dash"; S.open = null; S.lastUn = undefined; render(); }
(async () => { if (token) { try { me = await api("/me"); } catch { } } render(); })();
