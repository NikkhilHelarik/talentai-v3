# TalentAi v3 — AI Recruitment Portal
**Powered by [Helarik](https://www.helarik.com) · www.helarik.com**

FastAPI + SQLite backend, plain HTML/JS frontend (Bootstrap 5 + Font Awesome 6). Red / black / white theme taken from the TalentAi logo.

## Run
```
pip install -r requirements.txt
sh run.sh          # Windows: run.bat
```
Open http://127.0.0.1:8000 (camera needs `localhost` or HTTPS). First start creates the admin: `admin@recruit.local / Admin@12345` (change it, or set `ADMIN_EMAIL` / `ADMIN_PASSWORD`).
Your v2 database (`backend/recruit_v2.db`) can be copied over: the new `photo` column is added automatically.

## What changed in v3
* **Font Awesome icons** everywhere instead of emojis (including emotion icons); polished glass UI, avatars, question palette, empty states, custom confirm dialogs.
* **TalentAi logo + theme**, favicon, and **Powered by Helarik** (link to www.helarik.com) on login, sidebar, footer, exams and reports.
* **Profile photo** is required (profile edit). Limits enforced in browser *and* server: JPG/PNG/WebP, max 3 MB, min 200×200 px, auto square-cropped to 320×320, server re-checks type/magic bytes/≤200 KB. Every other profile limit (name, valid phone, city, skills, complete education rows, date ranges, max lengths) is validated with an error list and highlighted fields. Photos show in the sidebar and in admin tables/reports.
* **Question counts:** assessment **20** (30 minutes), technical **10**, AI interview **15**. Question bank enlarged (104 MCQ / 52 technical / 45 interview) so candidates still get different sets.
* **Proctoring in all three rounds** (shared engine `frontend/proctor.js`), with a system-check lobby (camera, AI models, calibration, rules):
  * face not visible → immediate warning, violation after ~3.5 s; combined warning *"face not visible while a smart device is detected"*
  * **smart-device detection** (phone / remote / laptop via COCO-SSD) and **device in hand** (device overlapping the person / near the face)
  * **eye tracking** (pupil position + head pose, calibrated), more than one person, fullscreen exit, copy/paste, camera disconnected
  * **a tab or window change FAILS the test** (application is rejected and the candidate notified). Other violations are warned and counted; 6 fail the test.
  * Admin sees a **proctoring log** (candidate list → *Log*, and inside reports); reports include device / hand / eyes-off percentages.

## Settings (environment variables)
`R1_QUESTIONS=20 R2_QUESTIONS=10 IV_QUESTIONS=15 R1_MINUTES=30 R2_MINUTES=30 IV_ANSWER_SECONDS=120 MAX_VIOLATIONS=6 TAB_FAIL=1 R1_PASS=60`
`TAB_FAIL=2` would allow one accidental tab change (second one fails). `CSP_UNSAFE_EVAL=1` only if a browser blocks the AI libraries.

## Notes & limits (please read)
* Camera AI (face-api.js, COCO-SSD) loads from jsDelivr / Google model storage → the candidate's browser needs internet. If a model cannot load, the lobby says so and the test continues with the remaining guards.
* Device detection is a computer-vision heuristic: it can miss a hidden phone or flag look-alike objects; "in hand" means the device overlaps the person/face area. Eye tracking is approximate (lighting, glasses). Treat AI values as indicators for a human reviewer.
* Video is processed only in the browser; it is never recorded or uploaded.
* Camera is now required for rounds 1 and 2 as well.
