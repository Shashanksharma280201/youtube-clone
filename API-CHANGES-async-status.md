# Video Extraction API — Async + Full Response + Status Endpoint

Changes made in this session to the internal video-extraction service. Written 2026-07-17.

---

## 1. Summary of changes

| # | Change | Files |
|---|--------|-------|
| 1 | **Reverted the API to asynchronous** — `POST /videoExtraction` no longer holds the request open; it starts the durable job and returns `202` immediately. | `src/app/api/v1/videoExtraction/route.ts`; removed `src/lib/waitForTerminal.ts` (+ test) |
| 2 | **Full data in the response** — the response now carries the complete machine `guide`, the full tagged `transcript`, and a top-level `thumbnailUrl`, in addition to the existing `chunks`. | `src/lib/videoExtractionResponse.ts` |
| 3 | **New `GET /response-status` endpoint** — poll a job by `resourceId`; returns `PROCESSING` / `FAILED`, or the full result inline on `DONE`. | `src/app/api/v1/response-status/route.ts` (+ test) |
| 4 | **Token-usage logging** (earlier this session) — every OpenAI call logs exact tokens + cost. | `src/lib/pipeline/usage.ts`, `openai.ts`, `transcribe.ts`, `transcribe-video.ts` |
| 5 | **Vision bug fix** — image calls defaulted to the flagship `gpt-5.4` (no image support); routed them to `gpt-5.4-mini` (which does), fallback `gpt-4o`. | `src/lib/pipeline/openai.ts`, `vision.ts` |

All changes keep existing response fields intact (backward compatible) — new fields are **added**, nothing renamed or removed.

---

## 2. How the flow works (async)

Think of a photo lab: you drop off film, get a ticket (`resourceId`), leave, and check back until it's ready.

```
POST /videoExtraction   ->  202 "PROCESSING"   (job started in the background)
        |
        |   (poll every few seconds with the same resourceId)
        v
GET /response-status?resourceId=...   ->  200 "PROCESSING"   (not ready yet)
                                      ->  200 "PROCESSING"
                                      ->  200 "DONE" + full result   (collect data)
                                      ->  200 "FAILED"               (stop, read error)
```

### Step 1 — Start the job
```bash
curl -X POST https://<service>/api/v1/videoExtraction \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -d '{
    "resourceId": "desolder-smd-001",
    "machineId":  "soldering-station-01",
    "tenantId":   "demo-tenant",
    "videoURL":   "https://<account>.blob.core.windows.net/videosvc/videos/desolder.mp4"
  }'
```
Immediate reply (HTTP `202`):
```json
{ "resourceId": "desolder-smd-001", "status": "PROCESSING", "chunks": [], "chunkCount": 0 }
```

### Step 2 — Poll the status
```bash
curl "https://<service>/api/v1/response-status?resourceId=desolder-smd-001" \
  -H "Authorization: Bearer <SERVICE_API_KEY>"
```
While running (HTTP `200`):
```json
{ "resourceId": "desolder-smd-001", "machineId": "soldering-station-01",
  "tenantId": "demo-tenant", "status": "PROCESSING", "pollAfterMs": 5000 }
```

### Step 3 — Get the data
When `status` becomes `DONE`, the **same** `/response-status` reply contains everything (see the full example in §4). No extra call.

### Status codes (the important rule)
For `/response-status`, the **HTTP code answers "did the status check work"**, not the job state — the job state is always in `body.status`:
- `200` — resource found; read `body.status` (`PROCESSING` / `DONE` / `FAILED`).
- `404` — unknown `resourceId`.
- `400` — `resourceId` missing.

(`POST /videoExtraction` keeps job-state codes: `202` processing, `200` done, `409` failed.)

---

## 3. What's in the response

Top-level fields (on `DONE`):

| Field | Meaning |
|-------|---------|
| `resourceId`, `machineId`, `tenantId` | echoes of what you sent |
| `status` | `DONE` |
| `title`, `description`, `createdAt` | video metadata |
| `thumbnailUrl` | signed cover thumbnail (video-level) — **new** |
| `guide` | **new** — full machine guide (see below) |
| `chunks` / `chunkCount` | chapters, each with `mainTag`, `subTag`, `transcript`, `summarizedText`, `tools`, `thumbnailUrl` |
| `transcript` | **new** — full timestamped transcript, each segment with `mainTag`/`subTag` |

The `guide` object (was previously dropped — only 4 fields used to leak through):

`machine`, `summary`, `overview`, `machineIntro`, `preventiveMaintenance`, `errorCodes`, `troubleshooting`, `safety`, `tools`, `parts`, `specs`, `glossary`.

**Not included** (would need a small DB change, out of scope here): `duration`, `category`, `phases`.

---

## 4. Complete response example (REAL run)

> **Real run.** Captured 2026-07-17 by processing the 95-minute "Expert Call — Issue Resolution" video through the actual pipeline (Whisper + GPT-5.4) and the real `buildExtractionResponse` builder. Cost: **$0.71** (Whisper $0.57 + GPT $0.14). The full response is **40 chapters + 1,155 transcript segments**; trimmed below to the complete `guide` + 2 chapters + 3 transcript segments for readability. URLs are placeholders (real responses return short-lived signed URLs).
>
> **Known issue visible in this output.** The Vision (image) calls failed — the pinned `gpt-5.4` models reject `image_url` inputs (`400 "image_url is only supported by certain models"`). The pipeline degrades gracefully, so the `guide` is still fully built from the transcript, but visual features are affected: some chapter `subTag`s read `"performing task"` (the vision fallback) and fix-step `visual` notes are empty. This is **pre-existing** (from the gpt-5.4 model pin), not caused by these changes. See §6.

`GET /api/v1/response-status?resourceId=expert-call-002` → `200`:

```json
{
  "resourceId": "expert-call-002",
  "machineId": "issue-resolution-line",
  "tenantId": "demo-tenant",
  "status": "DONE",
  "title": "Expert Call Part 2 - Issue Resolution.mp4",
  "description": "",
  "createdAt": "2026-07-17T10:00:00.000Z",
  "thumbnailUrl": null,
  "guide": {
    "machine": "Grove machine with B-axis hydraulic clamping system",
    "summary": "This video follows a real troubleshooting session on a Grove machine where the B-axis would not clear a hydraulic clamping alarm. The team works through pressure-switch settings, live inputs, and finally bleeding the hydraulic circuit so the table can rotate again and the alarm can be satisfied.",
    "overview": "You’re dealing with a machine that uses hydraulics to clamp and unclamp at least the B-axis, and the control watches that hydraulic state through a pressure switch called BP2. When that switch sees the right pressure condition, it sends signals back to the control so the machine will allow motion; when it does not, the machine stays in alarm and you can’t rotate the axis to reach the hardware underneath. In this case, the whole job turns into a chain reaction: the alarm blocks motion, blocked motion prevents access, and limited access makes it harder to bleed or inspect the hydraulic parts. The team uses the pressure switch display, the LEDs on the switch, the machine alarm text, the NC PLC variable screen, and the hydraulic diagram together to figure out whether the problem is truly pressure or whether the switch setup is what the control is unhappy about. By the end, you can see that the machine will move once the alarm is satisfied, but the deeper lesson is that the actual operating pressure still needs to be confirmed with Grove.",
    "machineIntro": [
      {
        "title": "B-axis hydraulic clamping circuit",
        "detail": "This machine’s B-axis uses hydraulic pressure to clamp and unclamp, and that hydraulic condition has to be correct before the control will allow the axis to move. When the pressure condition is wrong, or the control does not see the right signal, the machine reports a B-axis clamping or unclamping pressure alarm and blocks motion.",
        "steps": [],
        "start": 1200
      },
      {
        "title": "BP2 pressure switch",
        "detail": "BP2 is the pressure switch the team keeps working with. It has adjustable parameters like SP1, RP1, SP2, and RP2 on this installed switch, and it also has indicator LEDs that show whether its output conditions are being met. The team uses those LEDs as a quick visual check to see whether the switch is actually sending the condition the control expects.",
        "steps": [],
        "start": 883
      },
      {
        "title": "Controller input check",
        "detail": "The machine control has an NC PLC variable screen where you can look directly at input states. In the video, the team checks I97.7 and I97.6 to confirm whether the pressure-switch outputs are reaching the control, which helps separate a hydraulic problem from a wiring or signal problem.",
        "steps": [],
        "start": 2477
      },
      {
        "title": "Hydraulic manifold and bleed points",
        "detail": "Under the cover, the hydraulic manifold has vent or bleed points that let trapped air out of the circuit. The team removes covers to reach these points, then uses a small Allen wrench to push into the bleed point and release pressure and bubbles.",
        "steps": [],
        "start": 3097
      }
    ],
    "preventiveMaintenance": [],
    "errorCodes": [],
    "troubleshooting": [
      {
        "code": "",
        "title": "B-axis clamping pressure alarm blocks table rotation",
        "symptom": "The machine shows a B-axis clamping or unclamping pressure alarm and will not let you rotate the table to reach the valves underneath.",
        "story": "Start by seeing the machine the way the control sees it. The B-axis is protected by a hydraulic clamping circuit, and the control wants proof that pressure is in the expected range before it will allow motion. That proof comes from the BP2 pressure switch, so even if the machine physically has pressure, you can still be locked out if the switch is not set in a way the control accepts.\n\nWhat’s happening here is a classic trap: you need to rotate the table to get to the hydraulic parts, but the alarm prevents rotation. The team’s first practical move is not to force motion, because they say there is no way to jog it outside safety while the alarm is active. Instead, they temporarily work through the pressure-switch settings to satisfy the alarm just enough to gain access.\n\nTo diagnose it, watch three things together: the alarm text on the control, the live pressure value shown at the switch, and the LEDs on the switch. In this case, the B-axis pressure stayed around 1080 and did not behave the way they expected, while the switch LEDs and alarm details changed as settings were adjusted. That tells you the issue is not simply 'no pressure' — it is also about how the switch is configured and what signal the control is waiting for.",
        "fix": [
          {
            "text": "Power the machine back up and try to position the table so you can reach the valves underneath, if the alarm will allow it.",
            "expected": "You may be able to rotate the access around; if not, you will need another way to reach the hydraulic components.",
            "visual": "",
            "start": 278
          },
          {
            "text": "Get the hydraulic diagram and confirm that the clamp and valve under the table are the components you need to reach.",
            "expected": "You can identify the clamp and likely valve location under the table from the diagram.",
            "visual": "",
            "start": 307
          },
          {
            "text": "Do not try to bypass safety or jog the machine outside safety mode while the alarm is active.",
            "expected": "You avoid forcing motion in an unsafe condition.",
            "visual": "",
            "start": 758
          },
          {
            "text": "Go to the BP2 pressure switch and unlock setting mode by pressing and holding both arrow keys for 10 seconds.",
            "expected": "The switch shows it is unlocked and allows parameter changes.",
            "visual": "",
            "start": 883
          },
          {
            "text": "Document the original settings before changing anything.",
            "expected": "You have the original values recorded so you can restore them later.",
            "visual": "",
            "start": 994
          },
          {
            "text": "Lower SP1 from 1080 to 1060 as a temporary test.",
            "expected": "SP1 changes to 1060.",
            "visual": "",
            "start": 976
          },
          {
            "text": "Change SP2 from 1520 to 1020 as a temporary test.",
            "expected": "SP2 changes to 1020.",
            "visual": "",
            "start": 1022
          },
          {
            "text": "Watch the switch LEDs after changing the parameters.",
            "expected": "The left-hand side LED may turn orange, showing a condition change at the switch.",
            "visual": "",
            "start": 1085
          },
          {
            "text": "Close the door and turn hydraulics on so the machine can evaluate the pressure condition.",
            "expected": "The machine powers with hydraulics enabled and reevaluates the alarm.",
            "visual": "",
            "start": 1142
          },
          {
            "text": "If the alarm remains, restore the switch settings back to the chart values: SP1 1240, RP1 1020, SP2 1520, RP2 1300.",
            "expected": "The switch is back at the documented nominal values.",
            "visual": "",
            "start": 1675
          },
          {
            "text": "If needed for testing, adjust RP2 from 1300 down to 1000 and watch whether the switch LED state changes.",
            "expected": "You can see whether the output condition changes at the switch.",
            "visual": "",
            "start": 2174
          },
          {
            "text": "Put the camera or your eyes on the BP2 switch and compare its LEDs to the other pressure switches.",
            "expected": "You can tell whether the amber output LED is lit or not.",
            "visual": "",
            "start": 2258
          },
          {
            "text": "Raise RP2 above 1080 as a test until the left-side light comes on.",
            "expected": "The left-side LED lights, showing the switch condition has changed.",
            "visual": "",
            "start": 2332
          },
          {
            "text": "Go to the controller and reset the alarm.",
            "expected": "The alarm may change state or clear enough to continue diagnosis.",
            "visual": "",
            "start": 2378
          },
          {
            "text": "Open the NC PLC variable screen and check input I97.7, then enter I97.6 and check that as well.",
            "expected": "I97.7 shows 1 and I97.6 shows 1 when the switch outputs are reaching the control.",
            "visual": "",
            "start": 2477
          },
          {
            "text": "Set RP2 back to 1300 after the test and reset the control again.",
            "expected": "The right-side light goes off and the machine can be reset cleanly.",
            "visual": "",
            "start": 2685
          },
          {
            "text": "Try moving the B-axis again once the alarm is satisfied.",
            "expected": "The machine begins moving, showing you have enough access to continue with hydraulic work.",
            "visual": "",
            "start": 2775
          }
        ],
        "verify": "You know this part is successful when the machine will move the B-axis again and the alarm can be reset or changes enough to let you continue. In the video, the team sees the machine moving and calls that significant progress.",
        "ifNotResolved": "Check the BP2 switch LEDs again, verify I97.7 and I97.6 on the NC PLC variable screen, and compare the installed switch behavior to the diagram and door chart. If the pressure still sits at 1080 and the alarm logic still does not make sense, the team’s conclusion is to confirm the correct operating pressure with Grove and then adjust either the switch settings or the hydraulic pressure source accordingly.",
        "tools": [
          "hydraulic diagram",
          "electrical diagram",
          "camera/phone",
          "machine controller HMI"
        ],
        "difficulty": "Medium",
        "time": "~45 min",
        "start": 1155
      },
      {
        "code": "",
        "title": "Pressure switch settings do not match expected behavior",
        "symptom": "The BP2 switch shows pressure around 1080, but the alarm logic and LED behavior do not line up with what the team expects.",
        "story": "This is where you slow down and separate the number on the display from the meaning of the number. A pressure switch is not just a gauge; it is a decision-maker. It compares the live pressure to stored thresholds and then turns outputs on or off. So if the machine says pressure is missing, that does not always mean there is no pressure — it can mean the switch is not evaluating that pressure the way the control expects.\n\nIn the video, the team notices something important: the B-axis pressure sits at 1080 and does not change the way they expect, while the A-axis pressure does move. They also notice that some manuals show FH2 and FL2, while this installed switch shows SP2 and RP2. That leads them to suspect setup differences, switch-version differences, or even a documentation mismatch.\n\nThe practical lesson is to compare the installed switch, the chart on the machine door, and the live control inputs. If the switch outputs are reaching the control but the alarm still persists, then the problem may be that the pressure is outside the expected window or that the replacement switch was not set up exactly like the original.",
        "fix": [
          {
            "text": "Read the BP2 parameters currently in the switch: SP1, RP1, SP2, and RP2.",
            "expected": "You know the exact values currently stored in the switch.",
            "visual": "",
            "start": 1626
          },
          {
            "text": "Compare those values to the chart on the machine and restore them to the chart values if they were changed during testing.",
            "expected": "SP1 is 1240, RP1 is 1020, SP2 is 1520, and RP2 is 1300.",
            "visual": "",
            "start": 1675
          },
          {
            "text": "Note that changing set points may also change the related reset points, so recheck RP1 and RP2 after changing SP1 and SP2.",
            "expected": "You confirm the final values instead of assuming they stayed where they were.",
            "visual": "",
            "start": 1751
          },
          {
            "text": "Read the live pressure value on BP2 and compare it to the expected thresholds.",
            "expected": "You can see whether the live pressure is above or below the stored setpoints.",
            "visual": "",
            "start": 1918
          },
          {
            "text": "Use the switch LEDs to see whether the output condition is actually being met.",
            "expected": "You can tell whether the switch thinks the pressure condition is valid.",
            "visual": "",
            "start": 2290
          },
          {
            "text": "Use the NC PLC variable screen to confirm the switch outputs are reaching the control.",
            "expected": "Inputs I97.7 and I97.6 show 1 when the outputs are present.",
            "visual": "",
            "start": 2477
          },
          {
            "text": "If the machine only clears when RP1 is raised from 1020 to 1100, note that as a temporary workaround rather than a final answer.",
            "expected": "The alarm becomes satisfied, but you still know the root cause is not fully confirmed.",
            "visual": "",
            "start": 4209
          }
        ],
        "verify": "This issue is understood when you can explain whether the switch is failing to send an output, the control is failing to receive it, or the pressure is simply outside the expected threshold. In the video, the inputs show as present, which points the team away from wiring and toward pressure/setup.",
        "ifNotResolved": "Confirm with Grove what the operating pressure should be for that circuit and whether the replacement switch should use the same settings shown on the door chart. The team also notes a likely typo in the diagram where BP1 should have been BP2.",
        "tools": [
          "machine controller HMI",
          "pressure switch display",
          "electrical diagram",
          "door chart/manual"
        ],
        "difficulty": "Medium",
        "time": "~30 min",
        "start": 1515
      },
      {
        "code": "",
        "title": "Air trapped in the B-axis hydraulic circuit",
        "symptom": "The B-axis pressure behavior stays abnormal, and Grove recommends bleeding the system.",
        "story": "Once you’ve proved the machine can move again, the next suspect is trapped air in the hydraulic circuit. Hydraulics are supposed to transmit force through oil, which does not compress much. Air does compress, so when air gets trapped in a clamp circuit, the pressure reading and the actual clamping behavior can become inconsistent or sluggish.\n\nYou’ll notice the team does not jump straight into opening lines. They first work to get physical access to the manifold under the cover, then identify the vent points from the hydraulic diagram. That’s the right rhythm: identify, expose, then bleed. When they finally push into the bleed point, they get bubbles first and then a steadier flow, which is exactly the kind of clue you look for when air is leaving the system.\n\nThe important thing to understand is that bleeding changes the hydraulic condition, but it also creates risk. Pressure can spray out, and if you release pressure on the wrong axis, gravity or stored energy can move the mechanism. The team specifically warns that the B-axis rotating freely is manageable here, but doing the same on the Z-axis could let the whole axis drop.",
        "fix": [
          {
            "text": "Rotate the B-axis as far as you safely can so you can reach the underside and the hydraulic manifold cover.",
            "expected": "You gain access to the manifold area and bleed points.",
            "visual": "",
            "start": 2819
          },
          {
            "text": "Turn the hydraulics off before opening the hydraulic connection or bleed point.",
            "expected": "You reduce the chance of oil spraying everywhere.",
            "visual": "",
            "start": 2889
          },
          {
            "text": "Remove the cover over the manifold.",
            "expected": "You can see the manifold and the vent or bleed ports.",
            "visual": "",
            "start": 2971
          },
          {
            "text": "Use the hydraulic diagram to identify the vent ports you need to bleed.",
            "expected": "You know which ports on the manifold are the bleed points.",
            "visual": "",
            "start": 3097
          },
          {
            "text": "Crack the bleed point open only slightly or push into the bleed point carefully with a small Allen wrench, as shown.",
            "expected": "Hydraulic pressure releases and air bubbles may come out first.",
            "visual": "",
            "start": 2919
          },
          {
            "text": "Watch for bubbles coming out of the bleed point.",
            "expected": "You see bubbles first, then a more regular flow.",
            "visual": "",
            "start": 3621
          },
          {
            "text": "Repeat on the other bleed points if present.",
            "expected": "Additional trapped air is released from the circuit.",
            "visual": "",
            "start": 3686
          },
          {
            "text": "Close the door to pressurize the system again and observe the pressure reading.",
            "expected": "The circuit repressurizes and the pressure value changes.",
            "visual": "",
            "start": 3824
          },
          {
            "text": "Restore the BP2 switch settings to the documented values after bleeding: SP1 1240, RP1 1020, SP2 1520, RP2 1300.",
            "expected": "The switch is back at the intended settings for normal operation.",
            "visual": "",
            "start": 3881
          }
        ],
        "verify": "You want to see the pressure respond more normally after repressurizing, and you want the machine to clear alarms without relying on temporary threshold changes. In the video, the pressure briefly rises to 2500 after repressurizing, then later returns to 1080, which tells the team the issue is not fully solved yet.",
        "ifNotResolved": "If the pressure still returns to 1080 or the alarm comes back, the team’s conclusion is that there is still something wrong in the hydraulic condition or pressure adjustment. The next step is to confirm the correct operating pressure with Grove and, if needed, adjust the set screw on the replaced pressure-control component.",
        "tools": [
          "hydraulic diagram",
          "Allen wrench",
          "hand tools for cover removal"
        ],
        "difficulty": "Hard",
        "time": "~40 min",
        "start": 2066
      },
      {
        "code": "",
        "title": "Replacement pressure-control component may need adjustment",
        "symptom": "A new component was installed, but the machine only clears the alarm when the switch threshold is changed from the nominal value.",
        "story": "This is the kind of clue you learn to respect. When a machine suddenly needs a threshold bumped just to behave, and a new part was installed that same day, you stop assuming the machine changed and start asking whether the new part is adjusted correctly. In the video, the technician says a new one from Grove was installed that morning, and later points out a set screw that controls how much pressure is allowed through.\n\nThat matters because the pressure switch is only reporting what it sees. If the upstream pressure-control piece is adjusted too high or too low, the switch may be perfectly honest while the machine still alarms. The team gets the machine working by changing RP1 to 1100, but they treat that as a temporary way to satisfy the alarm, not proof that 1100 is the right final setting.\n\nYour diagnosis here is half hydraulic and half procedural: confirm the actual operating pressure with Grove, then adjust the set screw on the replaced component if needed so the real machine pressure falls where the documented switch settings expect it to be.",
        "fix": [
          {
            "text": "Note that a new component from Grove was installed the same morning.",
            "expected": "You recognize that a recent part change may be tied to the new behavior.",
            "visual": "",
            "start": 4575
          },
          {
            "text": "Use RP1 at 1100 only as a temporary way to satisfy the alarm and continue testing.",
            "expected": "The left light comes on and the alarm can be reset.",
            "visual": "",
            "start": 4209
          },
          {
            "text": "Confirm with Grove what the operating pressure should be for circuit 155 FC2 BP2.",
            "expected": "You get the correct target pressure from the machine source, not guesswork.",
            "visual": "",
            "start": 4389
          },
          {
            "text": "If Grove confirms the pressure should be different, adjust the set screw on the replaced pressure-control component to bring the circuit pressure closer to the correct level.",
            "expected": "The actual machine pressure moves toward the proper operating range.",
            "visual": "",
            "start": 4587
          },
          {
            "text": "After adjustment, return the pressure-switch settings to the documented values and retest.",
            "expected": "The machine clears alarms without needing a workaround threshold.",
            "visual": "",
            "start": 3881
          }
        ],
        "verify": "The real fix is proven when the machine runs with the documented switch settings and no alarm, without needing RP1 bumped to 1100. The team says the machine may run as-is for now, but they still want Grove to confirm the proper pressure and final adjustment.",
        "ifNotResolved": "Leave the machine partly assembled or ready for follow-up, contact Grove again, and revisit the pressure-control adjustment the next day if needed. The video ends with the team believing they have a workable temporary solution but not a fully closed root cause.",
        "tools": [
          "phone",
          "machine documentation",
          "tools to access set screw"
        ],
        "difficulty": "Hard",
        "time": "~30 min",
        "start": 4569
      }
    ],
    "safety": [
      {
        "title": "Do not bypass safety while an alarm is active",
        "detail": "The team specifically says there is no safe way to jog the machine outside safety mode while the alarm is present. Trying to force motion with an active alarm can create a dangerous condition and hide the real fault.",
        "steps": [
          "Do not try to jog the machine outside safety mode while the alarm is active.",
          "Satisfy the alarm condition first before attempting axis motion."
        ],
        "start": 758
      },
      {
        "title": "Hydraulic pressure can spray when opened",
        "detail": "When you crack open a hydraulic point, oil can spray hard because pressure is still trapped in the circuit. The team warns about this before bleeding.",
        "steps": [
          "Turn hydraulics off before opening the hydraulic point.",
          "Crack the point open only slightly.",
          "Expect spray and keep clear of the discharge path."
        ],
        "start": 2911
      },
      {
        "title": "Loss of hydraulic pressure can let an axis move freely",
        "detail": "The team explains that if you lose pressure on the B-axis, it may rotate freely, and if you do the same on the Z-axis, the whole axis could drop. That is stored energy and gravity working against you.",
        "steps": [
          "Support or control the axis before releasing hydraulic pressure.",
          "Be especially careful on vertical axes like Z.",
          "Do not release pressure unless you understand what motion may follow."
        ],
        "start": 2946
      },
      {
        "title": "Close the door to pressurize the system",
        "detail": "The machine requires the door closed to pressurize. That matters because repressurizing changes the hydraulic state and can change machine readiness.",
        "steps": [
          "Close the door before trying to pressurize the hydraulic system.",
          "Stand clear while the system repressurizes."
        ],
        "start": 3824
      },
      {
        "title": "Watch for loose hardware before moving the axis",
        "detail": "During testing, the team notices screws left on the guideway and stops to avoid crushing or damaging something. Small loose parts can become a bigger failure when the axis moves.",
        "steps": [
          "Inspect the guideway and work area for loose screws or tools before motion.",
          "Stop motion if anything is in the travel path."
        ],
        "start": 3987
      }
    ],
    "tools": [
      "hydraulic diagram",
      "electrical diagram",
      "machine controller HMI",
      "camera/phone",
      "Allen wrench",
      "hand tools for cover removal"
    ],
    "parts": [
      "BP2 pressure switch",
      "solenoid valve",
      "hydraulic manifold cover",
      "O-ring",
      "replacement pressure-control component with set screw"
    ],
    "specs": [
      {
        "label": "Temporary unlock action for pressure switch",
        "value": "Press and hold both arrow keys for 10 seconds",
        "start": 883
      },
      {
        "label": "Temporary test value for SP1",
        "value": "1060",
        "start": 1003
      },
      {
        "label": "Temporary test value for SP2",
        "value": "1020",
        "start": 1059
      },
      {
        "label": "Documented BP2 SP1",
        "value": "1240",
        "start": 1691
      },
      {
        "label": "Documented BP2 RP1",
        "value": "1020",
        "start": 1711
      },
      {
        "label": "Documented BP2 SP2",
        "value": "1520",
        "start": 1720
      },
      {
        "label": "Documented BP2 RP2",
        "value": "1300",
        "start": 1740
      },
      {
        "label": "Observed B-axis pressure reading",
        "value": "1080",
        "start": 1947
      },
      {
        "label": "Temporary test value for RP2",
        "value": "1000",
        "start": 2200
      },
      {
        "label": "Temporary workaround value for RP1",
        "value": "1100",
        "start": 4223
      },
      {
        "label": "Observed pressure after repressurizing",
        "value": "2500",
        "start": 3862
      },
      {
        "label": "Generic values seen on diagram for BP2",
        "value": "SP1 5 bar / 80 psi, RP1 40 psi, 1520, 1300",
        "start": 3339
      }
    ],
    "glossary": [
      {
        "term": "B-axis",
        "definition": "The machine axis being discussed here, tied to the rotating table and its hydraulic clamp."
      },
      {
        "term": "Hydraulic manifold",
        "definition": "A block that routes hydraulic oil to different valves and circuits."
      },
      {
        "term": "Pressure switch",
        "definition": "A sensor that watches pressure and turns electrical outputs on or off at set thresholds."
      },
      {
        "term": "SP1 / SP2",
        "definition": "Setpoints stored in the pressure switch that define pressure thresholds."
      },
      {
        "term": "RP1 / RP2",
        "definition": "Reset points or companion thresholds used by the pressure switch logic."
      },
      {
        "term": "FH / FL window setting",
        "definition": "A pressure window setting mentioned in the manual, meaning the switch looks for pressure within a range."
      },
      {
        "term": "NC PLC variable",
        "definition": "A controller screen where you can view live machine input or variable states."
      },
      {
        "term": "Solenoid valve",
        "definition": "A valve operated by an electrical coil that opens or closes hydraulic flow."
      },
      {
        "term": "Bleeding",
        "definition": "Letting trapped air out of a hydraulic circuit so the oil can transmit pressure properly."
      }
    ]
  },
  "chunks — showing 2 of 40": [
    {
      "chunkId": "cuid_demo_0001-0",
      "start": 0,
      "end": 79,
      "mainTag": "consult",
      "subTag": "Discussing prior technician change",
      "transcript": "I think he's got another technician who made the change as well. Okay. Okay. performing task performing task performing task",
      "summarizedText": "The team discusses that another technician may have already made a change while they continue working.",
      "tools": [],
      "thumbnailUrl": null,
      "blobUrl": "https://<storage-account>.blob.core.windows.net/videosvc/videos/source.mp4?<sas-token>",
      "videoSummary": "This video follows a real troubleshooting session on a Grove machine where the B-axis would not clear a hydraulic clamping alarm. The team works through pressure-switch settings, live inputs, and finally bleeding the hydraulic circuit so the table can rotate again and the alarm can be satisfied.",
      "domainMetaData": {
        "machine": "Grove machine with B-axis hydraulic clamping system",
        "summary": "This video follows a real troubleshooting session on a Grove machine where the B-axis would not clear a hydraulic clamping alarm. The team works through pressure-switch settings, live inputs, and finally bleeding the hydraulic circuit so the table can rotate again and the alarm can be satisfied.",
        "overview": "You’re dealing with a machine that uses hydraulics to clamp and unclamp at least the B-axis, and the control watches that hydraulic state through a pressure switch called BP2. When that switch sees the right pressure condition, it sends signals back to the control so the machine will allow motion; when it does not, the machine stays in alarm and you can’t rotate the axis to reach the hardware underneath. In this case, the whole job turns into a chain reaction: the alarm blocks motion, blocked motion prevents access, and limited access makes it harder to bleed or inspect the hydraulic parts. The team uses the pressure switch display, the LEDs on the switch, the machine alarm text, the NC PLC variable screen, and the hydraulic diagram together to figure out whether the problem is truly pressure or whether the switch setup is what the control is unhappy about. By the end, you can see that the machine will move once the alarm is satisfied, but the deeper lesson is that the actual operating pressure still needs to be confirmed with Grove.",
        "machineIntro": [
          {
            "title": "B-axis hydraulic clamping circuit",
            "detail": "This machine’s B-axis uses hydraulic pressure to clamp and unclamp, and that hydraulic condition has to be correct before the control will allow the axis to move. When the pressure condition is wrong, or the control does not see the right signal, the machine reports a B-axis clamping or unclamping pressure alarm and blocks motion.",
            "steps": [],
            "start": 1200
          },
          {
            "title": "BP2 pressure switch",
            "detail": "BP2 is the pressure switch the team keeps working with. It has adjustable parameters like SP1, RP1, SP2, and RP2 on this installed switch, and it also has indicator LEDs that show whether its output conditions are being met. The team uses those LEDs as a quick visual check to see whether the switch is actually sending the condition the control expects.",
            "steps": [],
            "start": 883
          },
          {
            "title": "Controller input check",
            "detail": "The machine control has an NC PLC variable screen where you can look directly at input states. In the video, the team checks I97.7 and I97.6 to confirm whether the pressure-switch outputs are reaching the control, which helps separate a hydraulic problem from a wiring or signal problem.",
            "steps": [],
            "start": 2477
          },
          {
            "title": "Hydraulic manifold and bleed points",
            "detail": "Under the cover, the hydraulic manifold has vent or bleed points that let trapped air out of the circuit. The team removes covers to reach these points, then uses a small Allen wrench to push into the bleed point and release pressure and bubbles.",
            "steps": [],
            "start": 3097
          }
        ]
      }
    },
    {
      "chunkId": "cuid_demo_0001-1",
      "start": 79,
      "end": 307,
      "mainTag": "action",
      "subTag": "Brief acknowledgment",
      "transcript": "Okay. Okay. Okay. Okay. Okay. Okay. Okay. Interesting setup. performing task performing task performing task Okay. performing task We're just powering back up. And then right here. We're going to try and leave the system. We're just trying to power up so we can rotate the, rotate the access around so we can get to the valves underneath. We don't know if we can rotate it. Otherwise we have to do it the manual way. Reach your hand under there or something.",
      "summarizedText": "They power the system back up and try to rotate the access to reach the valves underneath, considering a manual approach if needed.",
      "tools": [],
      "thumbnailUrl": null,
      "blobUrl": "https://<storage-account>.blob.core.windows.net/videosvc/videos/source.mp4?<sas-token>",
      "videoSummary": "This video follows a real troubleshooting session on a Grove machine where the B-axis would not clear a hydraulic clamping alarm. The team works through pressure-switch settings, live inputs, and finally bleeding the hydraulic circuit so the table can rotate again and the alarm can be satisfied.",
      "domainMetaData": {
        "machine": "Grove machine with B-axis hydraulic clamping system",
        "summary": "This video follows a real troubleshooting session on a Grove machine where the B-axis would not clear a hydraulic clamping alarm. The team works through pressure-switch settings, live inputs, and finally bleeding the hydraulic circuit so the table can rotate again and the alarm can be satisfied.",
        "overview": "You’re dealing with a machine that uses hydraulics to clamp and unclamp at least the B-axis, and the control watches that hydraulic state through a pressure switch called BP2. When that switch sees the right pressure condition, it sends signals back to the control so the machine will allow motion; when it does not, the machine stays in alarm and you can’t rotate the axis to reach the hardware underneath. In this case, the whole job turns into a chain reaction: the alarm blocks motion, blocked motion prevents access, and limited access makes it harder to bleed or inspect the hydraulic parts. The team uses the pressure switch display, the LEDs on the switch, the machine alarm text, the NC PLC variable screen, and the hydraulic diagram together to figure out whether the problem is truly pressure or whether the switch setup is what the control is unhappy about. By the end, you can see that the machine will move once the alarm is satisfied, but the deeper lesson is that the actual operating pressure still needs to be confirmed with Grove.",
        "machineIntro": [
          {
            "title": "B-axis hydraulic clamping circuit",
            "detail": "This machine’s B-axis uses hydraulic pressure to clamp and unclamp, and that hydraulic condition has to be correct before the control will allow the axis to move. When the pressure condition is wrong, or the control does not see the right signal, the machine reports a B-axis clamping or unclamping pressure alarm and blocks motion.",
            "steps": [],
            "start": 1200
          },
          {
            "title": "BP2 pressure switch",
            "detail": "BP2 is the pressure switch the team keeps working with. It has adjustable parameters like SP1, RP1, SP2, and RP2 on this installed switch, and it also has indicator LEDs that show whether its output conditions are being met. The team uses those LEDs as a quick visual check to see whether the switch is actually sending the condition the control expects.",
            "steps": [],
            "start": 883
          },
          {
            "title": "Controller input check",
            "detail": "The machine control has an NC PLC variable screen where you can look directly at input states. In the video, the team checks I97.7 and I97.6 to confirm whether the pressure-switch outputs are reaching the control, which helps separate a hydraulic problem from a wiring or signal problem.",
            "steps": [],
            "start": 2477
          },
          {
            "title": "Hydraulic manifold and bleed points",
            "detail": "Under the cover, the hydraulic manifold has vent or bleed points that let trapped air out of the circuit. The team removes covers to reach these points, then uses a small Allen wrench to push into the bleed point and release pressure and bubbles.",
            "steps": [],
            "start": 3097
          }
        ]
      }
    }
  ],
  "chunkCount": 40,
  "transcript — showing 3 of 1155": [
    {
      "start": 0,
      "end": 25,
      "text": "I think he's got another technician who made the change as well.",
      "mainTag": "consult",
      "subTag": "Discussing prior technician change"
    },
    {
      "start": 25,
      "end": 43,
      "text": "Okay.",
      "mainTag": "consult",
      "subTag": "Brief acknowledgment"
    },
    {
      "start": 43,
      "end": 61,
      "text": "Okay.",
      "mainTag": "consult",
      "subTag": "Brief acknowledgment"
    }
  ]
}
```

Other states are much smaller:
```json
// still running
{ "resourceId": "expert-call-002", "machineId": "issue-resolution-line", "tenantId": "demo-tenant", "status": "PROCESSING", "pollAfterMs": 5000 }

// failed
{ "resourceId": "expert-call-002", "machineId": "issue-resolution-line", "tenantId": "demo-tenant", "status": "FAILED", "error": "processing failed" }

// unknown resourceId  (HTTP 404)
{ "resourceId": "nope", "status": "NOT_FOUND" }
```

---

## 5. Testing

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **44 tests pass** (10 files), including 5 new tests for `/response-status` (400 / 404 / PROCESSING / FAILED / DONE-inline) and 3 new tests for the expanded response (guide, tagged transcript, signed thumbnail).
- `npm run build` — production build succeeds; `/api/v1/response-status` registered as a route.
- **Real end-to-end pipeline run** (local, 2026-07-17): processed both a 9-second clip and the 95-minute "Expert Call" video through the actual pipeline + response builder. The 95-min run produced the real response in §4 (40 chapters, 1,155 transcript segments, full guide) for **$0.71**.
- **Not tested:** the live HTTP round-trip `POST /videoExtraction → poll /response-status → DONE` against a running server + DB. It requires the video to already be in cloud storage and a DB with the `externalId` column (the local dev DB lacks it). The pipeline + response builder are verified by the real run above; the route handlers by unit tests.

## 6. Not done / decisions still open

- **Vision bug — FIXED.** The real run surfaced it: image calls hit `400 "image_url is only supported by certain models"` because they defaulted to the **flagship gpt-5.4**, which can't take images. A/B probe showed **gpt-5.4-mini *does* support `image_url`**, so vision now routes to `gpt-5.4-mini` (in-family) with `gpt-4o` as fallback (`openai.ts` `opts.vision`). Re-tested on real frames: 3/3 real descriptions, 0 fallback. Note: the §4 capture was taken **before** this fix, so it still shows `"performing task"` placeholders — a fresh run would now fill those in.
- Progress bar (`stage` + `percent`) is **not** built — `/response-status` returns coarse `status` only. Adding it needs two DB columns (`transcriptStage`, `transcriptProgress`) updated per pipeline step.
- `duration`, `category`, `phases` are **not** in the response (need persistence).
- Nothing has been pushed; changes are local to `youtube-clone`. The `amby` repo is untouched.
