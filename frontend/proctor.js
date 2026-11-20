"use strict";
/* TalentAi proctoring engine - shared by the assessment, the technical round and the AI interview.
   Camera + face AI (face-api.js) + object AI (COCO-SSD: phones / smart devices) + eye tracking + tab / window / fullscreen / clipboard guards.
   Everything is processed inside the browser. Video is NEVER recorded or uploaded - only event names and numbers reach the server. */
window.PR = (() => {
  const CDN = "https://cdn.jsdelivr.net/npm/";
  const FACE_JS = CDN + "@vladmandic/face-api@1.7.12/dist/face-api.js", FACE_MODEL = CDN + "@vladmandic/face-api@1.7.12/model/";
  const TF_JS = CDN + "@tensorflow/tfjs@4.22.0/dist/tf.min.js", COCO_JS = CDN + "@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
  const EMO = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];
  const DEV = { "cell phone": 0.35, remote: 0.5, laptop: 0.6 };      // object classes treated as smart devices -> minimum confidence
  const GAZE = { yaw: 0.13, pit: 0.12, pupil: 0.14 };                 // allowed deviation from the calibrated "looking at the screen" position
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $id = id => document.getElementById(id);
  const vid = () => $id("cam");
  const loadJs = src => ((loadJs.c = loadJs.c || {})[src] = loadJs.c[src] || new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loadJs.c[src]; rej(new Error("load failed")); }; document.head.appendChild(s); }));
  let Z = {}, ai = false, od = null, faceReady = false;

  /* ---------- models ---------- */
  async function loadFace() {
    if (!window.faceapi) await loadJs(FACE_JS);
    if (!faceReady) await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL), faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL), faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODEL)]);
    faceReady = true;
  }
  async function loadObj() {
    if (od) return;
    if (!window.tf) { if (window.faceapi && faceapi.tf) window.tf = faceapi.tf; else await loadJs(TF_JS); }   // share the TensorFlow.js instance that face-api already bundles
    if (!window.cocoSsd) await loadJs(COCO_JS);
    od = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  }

  /* ---------- lobby / system check ---------- */
  const ic = (n, c = "") => `<i class="fa-solid fa-${n} ${c}"></i>`;
  const setS = (id, t) => { const e = $id(id); if (e) e.innerHTML = t; };
  const camHTML = (o = {}) => `<div class="cam-wrap"><video id="cam" autoplay muted playsinline></video><div class="cam-chips"><span class="st st-mut" id="chFace">${ic("user")} Face</span><span class="st st-mut" id="chEye">${ic("eye")} Eyes</span><span class="st st-mut" id="chDev">${ic("mobile-screen")} Device</span>${o.emo ? `<span class="st st-info" id="chEmo"></span>` : ""}</div><span class="rec">${ic("circle")} LIVE</span></div>`;

  function lobby(cfg) {
    stop(); Z = { cfg, emotions: !!cfg.emotions, handlers: [], lastV: {}, cool: {}, nz: {}, preview: false, pr: [] }; ai = false;
    const tf = cfg.tabFail || 1, rules = [
      `Keep your <b>face visible</b>, stay <b>alone</b> in the frame and look at the screen.`,
      `Keep <b>phones, tablets, smartwatches and other smart devices</b> out of sight &ndash; the camera AI detects devices and devices held in the hand.`,
      `<b>Do not change tab or window.</b> ${tf === 1 ? "The first tab or window change <b>fails the test</b>." : `${tf} tab or window changes <b>fail the test</b>.`}`,
      `Stay in fullscreen and do not copy or paste. Other violations (face lost, looking away, device, extra person) are warned and logged &ndash; <b>${cfg.maxV || 6}</b> of them fail the test.`,
      `Video is processed in your browser only and is never recorded or uploaded. AI values are indicators for human reviewers, not a verdict.`,
      ...(cfg.rules || [])];
    root.innerHTML = `<div class="container py-4 fx" style="max-width:1080px"><div class="glass p-4"><div class="d-flex justify-content-between align-items-start flex-wrap gap-2"><div><h3 class="mb-1">${ic("shield-halved", "me-2 text-acc")}${esc(cfg.title)}</h3><p class="text-muted mb-3">${cfg.sub || ""}</p></div>${brandMini()}</div>
    <div class="row g-4"><div class="col-lg-6">${camHTML()}<div class="small text-muted mt-2">${ic("circle-info")} The chips on the video show live what the AI sees. Make sure the face is lit and no device is visible.</div></div>
    <div class="col-lg-6"><div class="chk"><div class="chk-i">${ic("video")}</div><div class="flex-grow-1"><b>1. Camera${cfg.audio ? " &amp; microphone" : ""}</b><div class="small text-muted" id="s1">Not started</div></div><button class="btn btn-glass btn-sm" data-act="prenable">Enable</button></div>
    <div class="chk"><div class="chk-i">${ic("microchip")}</div><div class="flex-grow-1"><b>2. AI models</b> <span class="small text-muted">(face &bull; eyes &bull; device)</span><div class="small text-muted" id="s2">Load after the camera is enabled</div></div></div>
    <div class="chk"><div class="chk-i">${ic("crosshairs")}</div><div class="flex-grow-1"><b>3. Calibration</b><div class="small text-muted" id="s3">Look straight at the screen when asked</div></div><button class="btn btn-glass btn-sm" data-act="prcal">Calibrate</button></div>
    <div class="small glass p-3 my-3"><b>${ic("list-check", "me-1")}Rules</b><ul class="mb-0 ps-3 mt-1">${rules.map(r => `<li class="mb-1">${r}</li>`).join("")}</ul></div>
    <label class="d-flex gap-2 mb-3"><input type="checkbox" id="rules" data-act="prrules"> <span>I understand and agree to the rules and to AI analysis of my camera feed in my browser.</span></label>
    <button class="btn btn-grad px-4 py-2" id="begin" data-act="prbegin" disabled>${ic("play", "me-2")}${esc(cfg.beginText || "Begin")} (fullscreen)</button> <button class="btn btn-glass" data-act="home">Cancel</button></div></div></div></div>`;
  }
  function check() { const b = $id("begin"); if (b) b.disabled = !(Z.stream && (!ai || Z.base) && $id("rules")?.checked); }
  const OK = t => `${ic("circle-check", "text-success")} ${t}`, BAD = t => `${ic("circle-xmark", "text-danger")} ${t}`, WARN = t => `${ic("triangle-exclamation", "text-warning")} ${t}`, WAIT = t => `${ic("spinner fa-spin")} ${t}`;

  async function enableCam() {
    try {
      Z.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: !!Z.cfg.audio });
      vid().srcObject = Z.stream; setS("s1", OK(`Camera${Z.cfg.audio ? " &amp; microphone" : ""} ready`)); loadModels();
    } catch { setS("s1", BAD("Allow camera" + (Z.cfg.audio ? " and microphone" : "") + " access in the browser, then click Enable again")); }
    check();
  }
  async function loadModels() {
    setS("s2", WAIT("Loading face &amp; eye AI..."));
    try { await loadFace(); ai = true; } catch { ai = false; }
    let objMsg = "";
    if (ai) { setS("s2", WAIT("Loading smart-device detector...")); try { await loadObj(); objMsg = "device AI ready"; } catch { od = null; objMsg = "device AI could not load"; } }
    setS("s2", !ai ? WARN("Face AI could not load (offline?). The test continues with tab / fullscreen proctoring only.") : OK("Face &amp; eye AI ready") + (od ? `<br>${OK("Smart-device detector ready")}` : `<br>${WARN("Smart-device detector could not load &ndash; devices will not be detected")}`));
    if (ai) { Z.preview = true; Z.loop = setInterval(tick, 500); }
    check();
  }
  async function calibrate() {
    if (!Z.stream) return toast("Enable the camera first", "warning"); if (!ai) return toast("Face AI is not available - calibration is not needed", "info");
    setS("s3", WAIT("Look straight at the screen and stay still...")); const ys = [], ps = [], pu = [];
    for (let k = 0; k < 18 && ys.length < 10; k++) { const f = await detect(false); if (f.length === 1) { const g = gaze(f[0]); ys.push(g.yaw); ps.push(g.pit); const p = pupil(f[0]); if (p != null) pu.push(p); } await sleep(400); }
    if (ys.length < 6) return setS("s3", BAD("Face not detected clearly. Improve the lighting, face the camera and try again"));
    Z.base = { yaw: mean(ys), pit: mean(ps), pup: pu.length >= 5 ? mean(pu) : null }; setS("s3", OK("Calibrated" + (Z.base.pup != null ? " (head + eye tracking)" : " (head tracking)"))); check();
  }

  /* ---------- detection ---------- */
  async function detect(emo) {
    try { const t = faceapi.detectAllFaces(vid(), new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks(true); return await (emo ? t.withFaceExpressions() : t); } catch { return []; }
  }
  const gaze = f => { const p = f.landmarks.positions; return { yaw: (p[30].x - p[0].x) / (p[16].x - p[0].x), pit: (p[30].y - p[27].y) / (p[8].y - p[27].y) }; };
  /* Eye tracking: horizontal pupil position inside each eye (darkest pixels of the eye region), 0 = left corner ... 1 = right corner. */
  function pupil(f) {
    try {
      const v = vid(), p = f.landmarks.positions, cv = Z.cv || (Z.cv = document.createElement("canvas")), cx = cv.getContext("2d", { willReadFrequently: true }), out = [];
      for (const [a, b] of [[36, 41], [42, 47]]) {
        const xs = [], ys = []; for (let i = a; i <= b; i++) { xs.push(p[i].x); ys.push(p[i].y); }
        const x0 = Math.max(0, Math.min(...xs) - 2), x1 = Math.min(v.videoWidth, Math.max(...xs) + 2), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(v.videoHeight, Math.max(...ys)), w = Math.round(x1 - x0), h = Math.round(y1 - y0);
        if (w < 12 || h < 4) return null;
        cv.width = w; cv.height = h; cx.drawImage(v, x0, y0, w, h, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h).data, L = new Float32Array(w * h); for (let i = 0; i < L.length; i++) L[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
        const thr = Array.from(L).sort((m, n) => m - n)[Math.floor(L.length * 0.18)]; let sx = 0, sw = 0;
        for (let i = 0; i < L.length; i++) if (L[i] <= thr) { const wt = thr - L[i] + 1; sx += (i % w) * wt; sw += wt; }
        out.push(sw ? sx / sw / w : 0.5);
      }
      return mean(out);
    } catch { return null; }
  }
  const inBox = (cx, cy, b) => cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3];

  async function tick() {
    if ((!Z.active && !Z.preview) || Z.busy || !Z.stream || !vid() || !vid().videoWidth) return; Z.busy = true; let faces = [];
    Z.n = (Z.n || 0) + 1;
    try {
      if (ai) faces = await detect(Z.emotions); else if (Z.fd) faces = await Z.fd.detect(vid());
      if (od && (Z.n % 4 === 2)) { Z.objs = await od.detect(vid(), 12, 0.3); Z.objFresh = true; }
    } catch { }
    Z.busy = false; if (Z.active || Z.preview) process(faces, Date.now());
  }

  function process(f, now) {
    const n = f.length, live = Z.active, trig = (k, t) => { if (live) violation(k, t); }; let head = true, eyesOff = false, emo = null;
    if (!ai && !Z.fd) return;
    /* face present? (+ combined warning when a smart device was seen) */
    const devNear = now - (Z.devLast || 0) < 12000;
    if (n === 0) {
      Z.nf = Z.nf || now; const dt = now - Z.nf;
      if (live && dt > 1500 && !Z.nz.nf) { Z.nz.nf = 1; nudge(devNear ? "Your face is not visible and a smart device was detected" : "Your face is not visible - please look at the camera"); }
      if (dt > 3500 && now > (Z.cool.nf || 0)) { Z.cool.nf = now + 6000; trig("no_face", devNear ? "Face not visible while a smart device is detected" : "Your face is not visible"); }
    } else { Z.nf = 0; Z.nz.nf = 0; }
    /* more than one person */
    const persons = (Z.objs || []).filter(o => o.class === "person" && o.score >= 0.6);
    if (n > 1) { Z.mf = Z.mf || now; if (now - Z.mf > 2500 && now > (Z.cool.mf || 0)) { Z.cool.mf = now + 6000; trig("multiple_faces", "More than one person detected"); } } else Z.mf = 0;
    /* smart device / device in hand (object AI runs about every 2 s) */
    if (Z.objFresh) {
      Z.objFresh = false; const dv = (Z.objs || []).filter(o => DEV[o.class] !== undefined && o.score >= DEV[o.class]);
      if (dv.length) {
        Z.devHits = (Z.devHits || 0) + 1; Z.devLast = now; const fb = n ? f[0].detection.box : null;
        Z.held = dv.some(o => { const cx = o.bbox[0] + o.bbox[2] / 2, cy = o.bbox[1] + o.bbox[3] / 2; return persons.some(p => inBox(cx, cy, p.bbox)) || (fb && cx > fb.x - 1.6 * fb.width && cx < fb.x + 2.6 * fb.width && cy > fb.y + fb.height * 0.6 && cy < fb.y + 5 * fb.height); });
        if (Z.devHits >= 2 && now > (Z.cool.dev || 0)) { Z.cool.dev = now + 8000; nudgeOnce("dev", Z.held ? "Smart device in hand detected - put it away" : "Smart device detected - remove it from view"); trig(Z.held ? "device_in_hand" : "device_detected", Z.held ? "Smart device in hand detected" : "Smart device detected near you"); }
      } else { Z.devHits = 0; Z.held = false; }
      if (persons.length > 1) { Z.pHits = (Z.pHits || 0) + 1; if (Z.pHits >= 2 && now > (Z.cool.mf || 0)) { Z.cool.mf = now + 6000; trig("multiple_faces", "More than one person detected"); } } else Z.pHits = 0;
    }
    const devOn = now - (Z.devLast || 0) < 5000;
    /* gaze: head pose + eye (pupil) tracking, relative to the calibration */
    if (ai && n >= 1) {
      const g = gaze(f[0]), b = Z.base || { yaw: g.yaw, pit: g.pit, pup: null }; emo = f[0].expressions;
      head = Math.abs(g.yaw - b.yaw) < GAZE.yaw && Math.abs(g.pit - b.pit) < GAZE.pit;
      const pu = pupil(f[0]); if (pu != null) { Z.pr.push(pu); if (Z.pr.length > 5) Z.pr.shift(); }
      eyesOff = head && b.pup != null && Z.pr.length >= 3 && Math.abs(mean(Z.pr) - b.pup) > GAZE.pupil;
      if (!head || eyesOff) { Z.aw = Z.aw || now; if (now - Z.aw > 4500 && now > (Z.cool.aw || 0)) { Z.cool.aw = now + 6000; trig("looking_away", head ? "Please keep your eyes on the screen" : "Please look at the screen"); } } else Z.aw = 0;
    } else Z.aw = 0;
    const eye = n >= 1 && ai && head && !eyesOff;
    if (Z.acc) { const a = Z.acc; a.samples++; if (n >= 1) { a.face++; if (ai && !eye) a.away++; } if (eye) a.eye++; if (n > 1) a.multi++; if (devOn) a.device++; if (devOn && Z.held) a.hand++; if (eyesOff) a.eyeoff++; if (ai && n >= 1) { a.yaw.push(gaze(f[0]).yaw); a.pit.push(gaze(f[0]).pit); EMO.forEach(k => (a.emo[k] += (emo && emo[k]) || 0)); } }
    chips(n, eye, head, eyesOff, devOn, emo);
  }

  /* ---------- live chips / meters ---------- */
  function chips(n, eye, head, eyesOff, devOn, emo) {
    const R = (Z.roll = Z.roll || { eye: [], face: [], emo: [] }), push = (a, v) => { a.push(v); if (a.length > 12) a.shift(); };
    push(R.eye, eye ? 1 : 0); push(R.face, n ? 1 : 0); if (emo) push(R.emo, EMO.map(k => emo[k] || 0));
    const set = (id, cls, html) => { const e = $id(id); if (e) { e.className = "st " + cls; e.innerHTML = html; } };
    set("chFace", n === 1 ? "st-ok" : "st-bad", n === 0 ? `${ic("user-slash")} No face` : n > 1 ? `${ic("users")} Multiple people` : `${ic("user-check")} Face OK`);
    if (ai) set("chEye", n && eye ? "st-ok" : n ? "st-warn" : "st-mut", n === 0 ? `${ic("eye")} Eyes` : eye ? `${ic("eye")} Eyes on screen` : `${ic("eye-slash")} ${head ? "Eyes off-screen" : "Looking away"}`); else set("chEye", "st-mut", `${ic("eye")} Eyes n/a`);
    if (od) set("chDev", devOn ? "st-bad" : "st-ok", devOn ? `${ic(Z.held ? "hand-holding" : "mobile-screen")} ${Z.held ? "Device in hand" : "Device detected"}` : `${ic("mobile-screen")} No device`); else set("chDev", "st-mut", `${ic("mobile-screen")} Device n/a`);
    if (!ai || !R.emo.length) return;
    const em = EMO.map((_, i) => mean(R.emo.map(v => v[i]))), top = em.indexOf(Math.max(...em)), chM = $id("chEmo"); if (chM) chM.innerHTML = `${emoIc(EMO[top])} ${EMO[top]}`;
    const nerv = Math.min(100, (em[2] + em[3] + em[4] + em[5] + em[6] * 0.5) * 150), eyeR = mean(R.eye) * 100, faceR = mean(R.face) * 100, conf = 0.4 * eyeR + 0.3 * (100 - nerv) + 0.3 * faceR;
    [["c", conf], ["e", eyeR], ["k", Math.max(0, 100 - nerv)]].forEach(([k, v]) => { const l = $id("l" + k), b = $id("b" + k); if (l) l.textContent = Math.round(v) + "%"; if (b) b.style.width = Math.round(v) + "%"; });
  }

  /* ---------- warnings ---------- */
  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(); o.frequency.value = 680; o.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 260); } catch { } }
  function banner(t, cls) {
    $id("warn")?.remove(); const d = document.createElement("div"); d.id = "warn"; d.className = "warnbar " + (cls || ""); d.setAttribute("role", "alert");
    d.innerHTML = `${ic("triangle-exclamation", "me-2")}${esc(t)}`; document.body.appendChild(d); document.body.classList.add("flash"); setTimeout(() => document.body.classList.remove("flash"), 1300); setTimeout(() => d.remove(), 5200); beep();
  }
  function warn(t) { banner(t); try { const u = new SpeechSynthesisUtterance("Warning. " + t.replace(/^Warning \d+\/\d+: /, "")); u.rate = 1.1; speechSynthesis.speak(u); } catch { } }
  function nudge(t) { banner(t, "soft"); }                                         // early warning, not counted yet
  function nudgeOnce(k, t) { if (!Z.nz[k]) { Z.nz[k] = 1; setTimeout(() => (Z.nz[k] = 0), 9000); nudge(t); } }

  async function violation(kind, text) {
    if (!Z.active || !Z.host) return; const now = Date.now(); if (now - (Z.lastV[kind] || 0) < 2500) return; Z.lastV[kind] = now; const h = Z.host;
    try {
      const r = await api(`/proctor/${h.aid}`, "POST", { rnd: h.rnd, kind, detail: text }); if (!Z.active) return;
      h.onCounter && h.onCounter(r);
      if (r.terminate) { Z.active = false; return h.onFail(r.message || "Your test was ended because of proctoring violations."); }
      warn(`Warning ${r.soft ?? r.violations}/${r.limit}: ${text}`);
    } catch { warn(text); }
  }

  /* ---------- guards: tab / window / fullscreen / clipboard / camera ---------- */
  function attach() {
    const add = (t, e, f) => { t.addEventListener(e, f); Z.handlers.push([t, e, f]); };
    add(document, "visibilitychange", () => document.hidden && violation("tab_switch", "You changed the tab or window"));
    add(window, "blur", () => setTimeout(() => Z.active && !document.hidden && !document.hasFocus() && violation("window_blur", "The test window lost focus (window change)"), 600));
    add(document, "fullscreenchange", () => { if (!document.fullscreenElement && Z.active) { violation("fullscreen_exit", "You exited fullscreen"); showFs(); } });
    ["paste", "copy", "cut"].forEach(k => add(document, k, e => { e.preventDefault(); violation("copy_paste", "Copy/paste is disabled"); }));
    add(document, "contextmenu", e => e.preventDefault());
    Z.stream.getVideoTracks().forEach(t => t.addEventListener("ended", () => violation("camera_off", "The camera was turned off")));
  }
  function showFs() {
    if ($id("fso")) return; const d = document.createElement("div"); d.id = "fso"; d.className = "fs-overlay";
    d.innerHTML = `<div class="glass p-5"><h3>${ic("expand", "me-2 text-acc")}Fullscreen required</h3><p>Return to fullscreen to continue. Leaving fullscreen is logged as a violation.</p><button class="btn btn-grad" data-act="prfs">Return to fullscreen</button></div>`; document.body.appendChild(d);
  }

  /* ---------- run / stop ---------- */
  async function begin() {
    try { await document.documentElement.requestFullscreen(); } catch { }
    Z.preview = false; clearInterval(Z.loop); Z.loop = null;
    try { await Z.cfg.onBegin(); } catch (e) { toast(e.message, "danger"); stop(); S.page = "dash"; render(); }   // S = app state (app.js)
  }
  /* host = { aid, rnd, emotions, onCounter(r), onFail(message) } - call after the test page (with camHTML) is on screen */
  function run(host) {
    Z.host = host; Z.active = true; Z.preview = false; Z.emotions = !!host.emotions; Z.fd = (!ai && "FaceDetector" in window) ? new FaceDetector({ fastMode: true, maxDetectedFaces: 3 }) : null;
    const v = vid(); if (v) { v.srcObject = Z.stream; v.play && v.play().catch(() => { }); }
    attach(); clearInterval(Z.loop); Z.loop = setInterval(tick, 500);
  }
  function stop() {
    if (Z.loop) clearInterval(Z.loop); (Z.handlers || []).forEach(([t, e, f]) => t.removeEventListener(e, f));
    if (Z.stream) Z.stream.getTracks().forEach(t => t.stop());
    try { speechSynthesis.cancel(); } catch { }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    ["warn", "fso"].forEach(id => $id(id)?.remove()); Z = {};
  }
  /* per-answer measurements (interview) */
  const resetAcc = () => { Z.acc = { samples: 0, face: 0, eye: 0, away: 0, multi: 0, device: 0, hand: 0, eyeoff: 0, emo: Object.fromEntries(EMO.map(k => [k, 0])), yaw: [], pit: [] }; };
  function vision() {
    const a = Z.acc; if (!ai || !a || a.samples < 3) return { ai: false, samples: 0, face: 0, eye: 0, away: 0, multi: 0, emo: {}, stability: 100, device: 0, hand: 0, eyeoff: 0 };
    const sd = x => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); }, emo = {}; EMO.forEach(k => (emo[k] = a.face ? a.emo[k] / a.face : 0));
    const stab = Math.max(0, 100 - Math.sqrt(sd(a.yaw) ** 2 + sd(a.pit) ** 2) * 450);
    return { ai: true, samples: a.samples, face: a.face, eye: a.eye, away: a.away, multi: a.multi, emo, stability: Math.round(stab * 10) / 10, device: a.device, hand: a.hand, eyeoff: a.eyeoff };
  }

  Object.assign(acts, {
    prenable: enableCam, prcal: calibrate, prrules: check, prbegin: begin,
    prfs: () => { document.documentElement.requestFullscreen().catch(() => { }); $id("fso")?.remove(); },
  });
  return { lobby, run, stop, camHTML, resetAcc, vision, stream: () => Z.stream, aiOn: () => ai, deviceOn: () => !!od, active: () => !!Z.active };
})();
