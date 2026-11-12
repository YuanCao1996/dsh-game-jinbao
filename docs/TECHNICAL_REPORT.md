# Jinbao: A Local-First Desktop Game Coach

**Technical Report — v0.2.17**

> How we turn a League of Legends client's own telemetry into one actionable sentence, and
> what breaks when you try.
>
> **Looking for diagrams instead of prose?** See [ARCHITECTURE.md](ARCHITECTURE.md) — system context,
> one advice turn as a sequence diagram, the augment observation state machine, and update integrity.

---

## Abstract

Jinbao is a Windows desktop coach that reads the game client's local telemetry (log streams and
the LCU API), projects it into a small set of *facts*, decides whether the current moment is worth
interrupting the player, and — only then — asks a language model for one or two actionable
sentences, which it renders in an always-on-top overlay and optionally speaks.

The engineering problem is not "call a model with game state". It is:

1. **Deciding when to speak** — a coach that narrates every event is worse than silence.
2. **Not lying** — the model must not treat speculation as fact, and OCR-based observation must
   never "guess" a choice into the permanent match record.
3. **Staying correct across time** — advice generated 40 seconds ago may be actively harmful now;
   the system needs explicit invalidation rather than optimism.

This report documents the architecture, the three subsystems where most of the difficulty lives
(trigger selection, augment observation, advice invalidation), the privacy and update-integrity
model, and the failure modes we hit in production.

---

## 1. Problem framing

Players already have statistics: win rates, tier lists, build sites. The questions that actually
stop a player mid-match are situational and short-lived:

- *"That fight just went wrong — why?"*
- *"I have 1200 gold and two magic-damage threats. What do I buy right now?"*
- *"Three augments are offered; which one fits the two I already own?"*

Each answer is worthless 20 seconds late, must name concrete entities (a champion, an item, an
augment), and must be executable. That defines the design constraints:

| Constraint | Consequence |
|---|---|
| Advice expires | Every generated recommendation carries explicit dependencies + TTL |
| Advice must be grounded | Facts are separated from speculation in the prompt itself |
| Interruptions are costly | A single admission gate decides what may speak |
| Data is intimate | All match data stays local; exports are redacted |

---

## 2. System overview

```
┌──────────────────┐   log stream / LCU    ┌────────────────────┐
│  Game client     │──────────────────────▶│  Acquisition       │
│  (LoL / other)   │   screen frames       │  lol-companion     │
└──────────────────┘──────────────────────▶│  collector.mjs     │
                                           │  augment-observer  │
                                           │  card-watch.ps1    │
                                           └─────────┬──────────┘
                                                     │ events (jsonl)
                                                     ▼
                                           ┌────────────────────┐
                                           │  Fact projection   │
                                           │  overlay-state.mjs │
                                           │  (pure function)   │
                                           └─────────┬──────────┘
                                    facts + current  │
                                                     ▼
                                           ┌────────────────────┐
                                           │  Coaching layer    │
                                           │  coaching-plan.js  │  trigger? → prompt → model
                                           │  automatic-pacing  │  → constraint check
                                           │  coach-server      │
                                           └─────────┬──────────┘
                                                     │ one sentence (+ validity)
                                                     ▼
                                           ┌────────────────────┐
                                           │  Presentation      │
                                           │  WPF overlay (PS)  │  modes / subtitles
                                           │  speech queue      │  TTS + audit log
                                           │  exploration store │  match memories
                                           └────────────────────┘
```

| Component | Responsibility |
|---|---|
| `tools/lol-companion/*` | Log tailing, LCU polling, augment card observation, event journal |
| `tools/dsh-onboarding/overlay-state.mjs` | Pure projection: events → displayable view |
| `tools/dsh-coach-server/lib/lol-coaching-plan.js` | Trigger states, prompts, output rules, invalidation |
| `tools/cloud-desktop/automatic-pacing.mjs` | Shared admission gate for automatic analysis |
| `tools/desktop-release/*.ps1` | Overlay rendering (WPF + PowerShell 5.1) |
| `tools/cloud-desktop/speech.mjs` | TTS queue, expiry, audit trail |
| `tools/jinbao-launcher/*` | Launcher, signed updater, package verification |

Project scale at v0.2.17: ~23k lines of non-test source across Node.js and PowerShell, 176
champions in the local roster (173 bundled portraits), 180 test files.

---

## 3. Acquisition

### 3.1 Log streams and LCU

The League client writes a per-match event journal (`lol-live-<id>.jsonl`) containing kills,
items, objectives, phase changes and the raw client state snapshot. A collector tails it and
publishes normalized events. A second stream polls the LCU (`/liveclientdata/*`) for the
authoritative player state (KDA, level, gold, items, deaths).

Both streams are *append-only* and timestamped; the projector never mutates history.

### 3.2 Augment observation is the hard part

Hextech ARAM offers three augment cards; their identity is **not** in the API, so it must be read
from the screen. This is where naive implementations fail: OCR is noisy, cards are refilled, and a
wrong guess permanently poisons the match record (and therefore every later recommendation).

Our approach (`augment-observer.mjs` + `card-watch.ps1`):

1. **Per-slot baseline diffing.** Three card regions are sampled ~20×/s; each slot is compared
   against *its own first frame*, so a "selection" is a local change, not a global screen diff.
2. **Punctuation normalization.** A real card read as `质变．棱彩阶` while the catalogue says
   `质变：棱彩阶`; catalog matching normalizes punctuation before comparing, otherwise cards
   silently vanish from the panel.
3. **Two-line title joining.** OCR wraps long titles; only adjacent lines *inside the same card
   region* are joined. Never fuzzy-match an arbitrary description line.
4. **Blind-gap discipline.** Losing visibility (panel closed, overlay covering the region) is not a
   selection. A gap longer than `maxBlindGapMs` (15 s) invalidates the round instead of confirming.
5. **Confirmation fallback.** If the round ends without a confident read, the UI opens a
   confirmation panel listing only candidates from the current round, pre-selecting the
   highest-ranked one. The user taps once; nothing is invented.

The rule we enforce in code: *a pending pick is settled by evidence (round change, reroll,
panel close) and never by timeout optimism.*

### 3.3 Generic window observation

Non-LoL titles can be attached by window handle or by tailing a local `.log`/`.jsonl`. Identity
(game, mode, version) is written back as `待核实` (unverified), corroborated across frames, or
confirmed by the user; until it is confident, the pipeline does **not** apply LoL rules.

---

## 4. Fact projection

`overlay-state.mjs` is a pure function of (events, snapshots) → view model. Two properties matter:

- **Displayed clock comes from the game's elapsed seconds, not from when we observed it.** Epoch
  time only orders records; mixing the two makes advice say "at 12:30" about a 09:10 event.
- **Bounded state.** Events are capped (e.g. the key-event page keeps at most 40 rows; the panel
  keeps 200) so a long match cannot grow unbounded memory or prompt size.

The projected view is deliberately *presentation-shaped*: `events` and `augments` are rendered
text, `liveStats` is a small record. This is a useful boundary — but see §9.2 for a regression it
caused.

---

## 5. Coaching decision layer

### 5.1 Trigger selection: speak only when it changes a decision

Reasons are computed from deltas, not from event presence:

```js
reason = died            ? 'death'      :
         enemyChanged    ? 'enemyChange':
         ownItemsChanged ? 'purchase'   :
         materialChanged ? 'situation'  : null;
```

Each reason has its own cooldown (death 15 s, material 75 s, enemy change 30 s). Ordinary minion
kills are context, not triggers. The failure mode this avoids is a coach narrating the scoreboard.

### 5.2 Admission control

Battle advice and background build analysis share one permit, but **per-topic windows**. An
earlier single shared window let the frequent background tasks starve advice: in a real match we
measured 20 `output_backpressure` skips in 12 minutes with `advicePublished: 0`. Per-topic
tracking fixed it.

### 5.3 Prompt construction: facts vs speculation

The prompt is assembled from structured facts plus a stage-specific task. Rules that carry real
weight:

- **Speculation is labelled in the prompt, not left to the model's judgement.** Unconfirmed
  augments are passed as "暂按…考虑，待确认" candidates and must never be described as owned.
- **Hard fields win.** Multikill counts come from one field (`facts.multikill.streak` derived from
  the game's `KillStreak`), because models reliably miscount kills.
- **No panel restatement.** The UI already shows the ranking; the answer must be a decision.
- **Concrete nouns.** A death turn must name one purchasable item; "补个防装" is rejected by rule.

### 5.4 Output constraints

At most two sentences, ≤60 characters total, single paragraph; urgent situations get one sentence.
The model may not repeat the previous advice unless the facts changed. Speech and display share
the same source text — a separate truncation path for speech used to cut mid-item ("亡者的板甲，
针"), so display now uses the stripped text, and speech has its own explicit limit.

### 5.5 Validity and invalidation

Every advice record stores a dependency fingerprint:

```js
dependencies(current, stage) // e.g. {champion, owned: hash(ownedAugments)}
```

`adviceIsValid()` recomputes the fingerprint and compares. Consequences:

- A new confirmed augment invalidates augment-scoped advice.
- Buying one component does **not** invalidate objective/coordination advice — it depends on
  who is alive, not on gold.
- Opening build plans depend on champion **and** owned augments (§6).

This replaced a simpler TTL-only model that produced self-contradicting advice (see §6).

---

## 6. Case study: augments that name items

Some augments reference a specific item, e.g. **钢化你心** ("Steel Your Heart") requires holding
**心之钢** (Heartsteel) and stacking it; **命运之武器** applies to your *first legendary item*;
**易损** rewards crit items.

**Bug found in a real match log.** The player confirmed 钢化你心 at ~3 minutes. The six-item build
plan for that match was:

```
Mercury's Treads → Force of Nature → Randuin's → Frozen Heart → Spirit Visage → Stoneplate
```

No Heartsteel anywhere — while a later single recommendation told the player *"combine Giant's
Belt into Heartsteel to unlock 钢化你心"*. Two subsystems disagreed, because:

```js
if (stage === 'opening') return { champion: me.champion };  // augments ignored
```

The opening plan's dependencies did not include augments and its TTL was 10 minutes, so the stale
plan stayed "valid" for the rest of the early game.

**Fix (three parts).**

1. Opening plans now depend on owned augments, so confirming one invalidates the plan.
2. A hard prompt rule: if a confirmed augment names an item, the build order and the next completed
   item must include it, with the reason stated.
3. `postAugment` now ends with "接下来怎么出" (remaining 2–3 items) instead of a single next item,
   so the plan is re-derived at the moment the augment becomes known.

We audited the last eight matches: four of the observed augments name or constrain items
(钢化你心 → Heartsteel, 命运之武器 → first legendary, 易损 → crit, 狂徒豪气 → resist stacking),
so this is not an edge case.

---

## 7. Presentation and voice

- **Overlay** is WPF hosted by PowerShell 5.1, in four display modes (large / narrow / subtitle /
  collapsed ball). The narrow mode keeps a live subtitle strip instead of collapsing to a dot, so
  the player does not lose the last sentence.
- **Subtitle splitting** respects semantics: punctuation never starts a line, number tokens
  (`No.22`, `53.5%`, `15/6/16`) are kept whole, and only two rows are visible at a time.
- **Speech queue** has an explicit expiry for *queued* items only; once audio starts it finishes.
  Every transition (`queued` / `started` / `completed` / `interrupted` / `discarded`) is appended to
  `logs/speech.jsonl` with original and spoken text, so display-vs-speech drift is auditable
  rather than argued about.

---

## 8. Privacy, credentials, and update integrity

- **Local-first state.** Match data, memories, preferences and diagnostics live under
  `%USERPROFILE%\.jinbao-cloud-preview\`. Nothing is uploaded; there is no leaderboard.
- **Credentials** are DPAPI-encrypted per Windows user (`credentials.dpapi`); custom model keys
  never go to our servers.
- **Diagnostics export** is redacted: no chat text, player names, credentials or screenshots.
- **Updates** are Ed25519-signed envelopes (`{payload, signature}`) fetched over a fixed official
  origin, verified with a public key shipped in the client; archives are immutable per version and
  the index is published atomically *after* the archive is verified reachable. A failed
  verification keeps the old version running.
- **Rollback safety.** The updater stages a new version and routes to it on next launch; the
  running directory is never overwritten mid-session.

---

## 9. Failure modes and lessons

Three incidents that shaped the engineering process more than any feature.

### 9.1 A JavaScript comment in a PowerShell file

A single `// 收起时…` line inside `overlay-playback.ps1` (PowerShell 5.1) is not a comment: it is a
command, producing `CommandNotFoundException` at collapse time. The supervisor restarted the
overlay, which looked to the user like "the window disappears and comes back". Fixes: every `.ps1`
is UTF-8 **with BOM** and uses only `#` comments; a CI-style check plus an unhandled-exception
logger that records `source`, `line`, `code` and `position` in `logs/overlay-mode.jsonl`.

### 9.2 A broken `else` chain

Adding a log line between `elseif (...)` and `else {` produced `CommandNotFoundException: else` at
a known line. The upgraded logger made it a one-minute diagnosis because it recorded the line and
code, not just a message. Lesson: **the next bug after a fix is usually the fix itself** — instrument
first, then edit.

### 9.3 Treating a display string as data

The coaching ticker was extended to pass "recent events" into the memory recorder:

```js
const events = (view.events || []).map(...)   // view.events is a rendered string
```

`.map` threw, the surrounding `try/catch` swallowed it, and **three consecutive matches produced no
memory at all**. The projection boundary (§4) is real: `events` is text for rendering, not an array.

Fix: the recorder reads the match's own journal (`readMatchLog(matchId)`) for authoritative
`GameEnd.Result`, final KDA/level, duration and multikill streaks; the view is used only for values
it actually owns. A recovery script replayed the historical journals and restored the six lost
matches.

**Lesson recorded in the repo:** never `try/catch` a pipeline silently; either log the skip reason
or let it fail loudly. Silent recovery is how a data-loss bug survives three matches.

---

## 10. Evaluation and known limitations

**Verified in this release cycle**

| Area | Evidence |
|---|---|
| Advice validity | Unit tests for dependency fingerprints (later augment invalidates, component purchase does not) |
| Augment-aware builds | Prompt assertions + offline replay of a real match journal; four item-naming augments enumerated |
| Memory recording | Replay of a real journal → KDA 32/11/21, win, level 18, 1247 s, triple+quadra+ace |
| Speech audit | 116 recorded speech transitions in one match; original vs spoken text diffable |
| Overlay stability | Zero unhandled UI exceptions across a full evening of collapse/resize cycles |

**Known limitations (honest list)**

- Augment identity is OCR-derived; ambiguous rounds fall back to user confirmation. Recall is good,
  precision is not perfect, and we prefer a confirmation prompt over a wrong fact.
- LoL (Hextech ARAM in particular) is the only deeply adapted title. Other games get window
  observation with explicit "unverified" identity.
- The model can still write advice that is technically true but operationally vague; the rules
  reduce this, they do not eliminate it.
- Some sandbox-dependent tests (vision-model calls, settings UI) are environment-sensitive and are
  excluded from the default run.
- Advice quality has not been validated against a control group; "good advice" remains a judgement
  call, not a measurement.

---

## 11. Non-goals

- Predicting match outcomes or assigning probabilities to a live game.
- Automating input, or reading game memory / injecting into the client.
- A cloud dashboard or leaderboard. The interesting data stays on the machine that produced it.

---

## 12. Reproduce

```powershell
git clone https://github.com/YuanCao1996/dsh-game-jinbao.git
cd dsh-game-jinbao
npm ci --ignore-scripts --legacy-peer-deps

# run the standalone desktop app against a scratch state dir
node tools/cloud-desktop/main.mjs --state "$HOME/.jinbao-cloud-preview-repro" --collect --coach

# targeted suites
node --test tools/dsh-coach-server/tests/lol-coaching-plan.test.mjs
node --test tools/dsh-onboarding/tests/*.test.mjs
```

Replaying an existing journal is supported by the same projection used in live polling, which is
why the regression in §9.3 could be reproduced offline with a real match file.

---

## 13. Data sources

League client log files and the local LCU HTTP API (the same public surface used by Overwolf-class
tools). Community/third-party data (augment names, champion stats) is fetched through a separate,
versioned index and never embedded as authoritative truth; when a value is missing, the advice says
so instead of inventing it.

---

*MIT licensed. This document describes v0.2.17 and is updated alongside the code; corrections via
issues are welcome.*
