"use strict";
/* AI live interview. Questions are read aloud, answers are captured with speech recognition (typing is the fallback).
   Camera / face / eye / device AI and the tab-fullscreen guards come from proctor.js (PR). Video is never recorded or uploaded. */
window.IV = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let st = {};

  function cleanup() {
    st.active = false; st.listening = false; clearInterval(st.cd);
    try { st.rec && st.rec.stop(); } catch { }
    try { speechSynthesis.cancel(); } catch { }
    if (window.PR) PR.stop(); st = {};
  }
  async function start(aid) {
    const d = await api(`/interview/${aid}`); cleanup();
    st = { aid, qs: d.questions, i: d.answered, title: d.title, ansSec: d.answer_seconds, maxV: d.max_violations, tabFail: d.tab_fail };
    PR.lobby({
      title: "AI live interview \u2013 system check", sub: `${esc(st.title)} &bull; ${st.qs.length} questions &bull; up to ${st.ansSec} seconds per answer`, audio: true, emotions: true, maxV: st.maxV, tabFail: st.tabFail, beginText: "Begin interview", onBegin: begin,
      rules: [`Speak clearly &ndash; each question is read aloud and your answer is transcribed live. Use Chrome or Edge for speech recognition.`],
    });
  }

  function begin() {
    st.active = true; buildUI(); PR.run({ aid: st.aid, rnd: 3, emotions: true, onCounter: counter, onFail: fail }); showQ();
  }
  function counter(r) {
    const v = document.getElementById("vc"); if (!v) return;
    v.innerHTML = `${ic("triangle-exclamation")} Warnings ${r.soft ?? r.violations}/${r.limit}`; v.className = "st " + ((r.soft ?? 0) >= r.limit - 1 ? "st-bad" : "st-warn");
  }
  function fail(msg) { cleanup(); resultView({ passed: false, message: msg }); }

  function buildUI() {
    const bar = (l, id) => `<div class="meter"><span>${l}</span><b id="l${id}">&ndash;</b></div><div class="bar mb-2"><i id="b${id}" style="width:0"></i></div>`;
    root.innerHTML = `<div class="container-fluid py-3 fx" style="max-width:1300px"><div class="glass p-3 mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2"><b>${ic("video", "me-2 text-acc")}${esc(st.title)} &ndash; AI live interview</b>
    <div class="d-flex gap-2 flex-wrap"><span class="st st-ok" id="vc">${ic("triangle-exclamation")} Warnings 0/${st.maxV}</span><span class="st st-mut">${ic("window-restore")} Tab change ${st.tabFail === 1 ? "fails the interview" : `x${st.tabFail} fails it`}</span><span class="st st-mut">${ic("lock")} Video is never recorded</span></div></div>
    <div class="row g-3"><div class="col-lg-5"><div class="glass p-3">${PR.camHTML({ emo: true })}
    <div class="mt-3"><h6>${ic("brain", "me-1")}Live AI analysis</h6>${PR.aiOn() ? bar("Confidence", "c") + bar("Eye contact", "e") + bar("Calm", "k") : `<div class="small text-muted">Face AI unavailable &ndash; only tab / fullscreen proctoring is active.</div>`}</div></div></div>
    <div class="col-lg-7"><div class="glass p-4" id="ivmain"><div class="d-flex justify-content-between"><span class="text-muted" id="qn"></span><span class="timer" id="cdn">--</span></div><div class="bar my-2"><i id="qp" style="width:0"></i></div>
    <div class="q-big my-3" id="qt"></div><button class="btn btn-glass btn-sm" data-act="ivrepeat">${ic("volume-high", "me-1")}Repeat question</button>
    <textarea id="tx" class="form-control my-3" rows="6" placeholder="Your spoken answer appears here live. Speak naturally and clearly."></textarea>
    <div class="d-flex gap-2 flex-wrap"><button class="btn btn-grad" id="bStart" data-act="ivstart">${ic("microphone", "me-2")}Start answering</button><button class="btn btn-grad d-none" id="bDone" data-act="ivdone">${ic("check", "me-2")}Finish answer</button></div>
    <div class="small text-muted mt-2">${SR ? "The question is read aloud and answering starts automatically. Click Finish when you are done." : "Speech recognition isn't supported in this browser (use Chrome or Edge) &ndash; please type your answer."}</div></div></div></div>${poweredBy()}</div>`;
  }

  function speak(t, cb) {
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.onend = () => cb && cb(); speechSynthesis.speak(u); } catch { cb && cb(); }
  }
  function showQ() {
    if (st.i >= st.qs.length) return finish(); const q = st.qs[st.i]; st.answering = false;
    document.getElementById("qn").textContent = `Question ${st.i + 1} of ${st.qs.length}`; document.getElementById("qt").textContent = q.q; document.getElementById("tx").value = "";
    document.getElementById("qp").style.width = (st.i / st.qs.length * 100) + "%"; document.getElementById("cdn").textContent = "--";
    document.getElementById("bStart").classList.remove("d-none"); document.getElementById("bDone").classList.add("d-none"); document.getElementById("bDone").disabled = false;
    speak(q.q, () => { if (!st.answering && st.active) beginAnswer(); });
  }
  function beginAnswer() {
    if (st.answering || !st.active) return; try { speechSynthesis.cancel(); } catch { } st.answering = true; st.t0 = Date.now(); st.final = ""; st.source = "typed"; PR.resetAcc();
    document.getElementById("bStart").classList.add("d-none"); document.getElementById("bDone").classList.remove("d-none"); st.left = st.ansSec;
    const cd = document.getElementById("cdn"), tick = () => { cd.textContent = st.left + "s"; cd.classList.toggle("low", st.left <= 15); }; tick();
    st.cd = setInterval(() => { st.left--; tick(); if (st.left <= 0) endAnswer(true); }, 1000);
    if (SR) {
      const r = new SR(), tx = document.getElementById("tx"); r.continuous = true; r.interimResults = true; r.lang = "en-US"; st.listening = true;
      r.onresult = e => { let f = "", im = ""; for (let k = 0; k < e.results.length; k++) (e.results[k].isFinal ? (f += e.results[k][0].transcript + " ") : (im += e.results[k][0].transcript)); st.final = f; tx.value = f + im; };
      r.onend = () => { if (st.listening) { try { r.start(); } catch { } } };
      try { r.start(); st.rec = r; st.source = "speech"; } catch { }
    }
  }
  async function endAnswer(auto) {
    if (!st.answering) return; const text = document.getElementById("tx").value.trim();
    if (!auto && text.split(/\s+/).filter(Boolean).length < 3) return toast("Please answer the question before finishing.", "warning");
    st.answering = false; clearInterval(st.cd); st.listening = false; try { st.rec && st.rec.stop(); } catch { } st.rec = null; document.getElementById("bDone").disabled = true;
    const dur = Math.min(900, (Date.now() - st.t0) / 1000);
    try { await api(`/interview/${st.aid}/answer`, "POST", { qid: st.qs[st.i].id, transcript: text, duration: dur, source: st.source, vision: PR.vision() }); st.i++; showQ(); }
    catch (e) { if (!st.active) return; toast(e.message, "danger"); st.answering = true; document.getElementById("bDone").disabled = false; }
  }
  async function finish() {
    st.active = false; document.getElementById("ivmain").innerHTML = `<div class="text-center p-5"><div class="skeleton mb-3"></div>Analysing your interview...</div>`;
    try { const r = await api(`/interview/${st.aid}/finish`, "POST"); cleanup(); resultView(r); } catch (e) { toast(e.message, "danger"); }
  }

  Object.assign(acts, { ivstart: beginAnswer, ivdone: () => endAnswer(false), ivrepeat: () => speak(st.qs[st.i].q) });
  return { start, cleanup };
})();
