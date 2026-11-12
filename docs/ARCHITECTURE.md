# Architecture

> A map of how Jinbao turns a game client's own telemetry into one sentence, and back again.
> Diagrams render natively on GitHub. For *why* the parts look like this, see
> [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md).

---

## 1. System context

```mermaid
flowchart LR
    subgraph Client["Game side"]
        LOL["League client<br/>logs + LCU API"]
        OTHER["Other titles<br/>window / log file"]
    end

    subgraph Acq["Acquisition · tools/lol-companion"]
        COL["collector.mjs<br/>log tail + LCU poll"]
        AUG["augment-observer.mjs<br/>+ card-watch.ps1"]
        CAP["capture-schedule.mjs<br/>screen frames"]
    end

    subgraph Proj["Fact projection · overlay-state.mjs"]
        STATE["pure function<br/>(events, snapshot) → view"]
    end

    subgraph Coach["Coaching · dsh-coach-server"]
        PLAN["lol-coaching-plan.js<br/>trigger · prompt · rules"]
        PACE["automatic-pacing.mjs<br/>admission gate"]
        SRV["coach-server :3081"]
    end

    subgraph Show["Presentation"]
        OVL["WPF overlay<br/>.ps1"]
        SPK["speech.mjs<br/>queue + audit"]
        EXP["exploration store<br/>match memories"]
    end

    LLM{{"Language model<br/>official cloud · or BYOK"}}

    LOL --> COL --> STATE
    LOL --> AUG --> STATE
    OTHER --> CAP --> STATE
    STATE --> PACE
    PACE --> PLAN --> SRV --> LLM
    LLM --> SRV --> OVL
    SRV --> SPK
    STATE --> EXP
    OVL -.-> SPK
```

| Layer | Directory | Rule it must never break |
|---|---|---|
| Acquisition | `tools/lol-companion/` | Observations are append-only; nothing is rewritten after the fact |
| Projection | `tools/dsh-onboarding/overlay-state.mjs` | Pure: same events in, same view out |
| Coaching | `tools/dsh-coach-server/` | Facts and speculation are separated *in the prompt* |
| Presentation | `tools/desktop-release/` | Overlay failure must never kill the match pipeline |
| Delivery | `tools/jinbao-launcher/` | Ship only what the signature verifies |

---

## 2. One advice turn

```mermaid
sequenceDiagram
    autonumber
    participant G as Game client
    participant C as Collector
    participant P as Projection
    participant S as Coach server
    participant M as Model
    participant O as Overlay
    participant T as TTS queue

    G->>C: kill / item / augment / phase
    C->>P: event journal append
    P-->>S: facts + current view
    S->>S: reason? (died / purchase / enemyChange / situation)
    alt no reason, or inside cooldown
        S-->>S: stay silent (this is the common case)
    else reason is worth interrupting
        S->>S: admission gate (per-topic window)
        S->>M: prompt = facts + speculation + stage task
        M-->>S: 1–2 sentences (≤60 chars)
        S->>S: constraint check (nouns, no panel restatement)
        S->>O: advice + dependency fingerprint + TTL
        S->>T: same text (never a second truncation path)
        O-->>G: renders over the game window
    end
```

The gate is deliberately boring: **most events produce nothing**. A coach that narrates every
event is noise, and noise is what makes players uninstall.

---

## 3. Augment observation lifecycle

Augment identity is not in the API — it is read off three card regions. The state machine exists so
that *nothing* is recorded without evidence.

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Candidate: card region changes vs its own baseline
    Candidate --> Candidate: more frames agree
    Candidate --> Pending: title matched against catalogue
    Candidate --> Idle: change was UI noise, e.g. hover or particle

    Pending --> Confirmed: panel closed AND round advanced
    Pending --> Confirmed: reroll consumed the round
    Pending --> Discarded: this slot was rerolled away
    Pending --> AskUser: panel closed, round over, no confident read

    AskUser --> Confirmed: user taps a candidate
    AskUser --> Idle: user dismisses, nothing recorded

    Idle --> Blind: region occluded / window lost
    Blind --> Idle: recovered within maxBlindGapMs
    Blind --> Idle: gap too long → whole round invalidated

    Confirmed --> [*]
```

| Guard | Value | Why |
|---|---|---|
| Frame freshness | ≤ 4 s | A stale frame must not confirm a live round |
| Blind gap tolerance | 15 s | Beyond this, previous readings are untrustworthy |
| Punctuation normalization | applied | `质变．棱彩阶` must match `质变：棱彩阶` |
| Title joining | same card only | OCR wraps long titles; descriptions are never fuzzy-matched |
| Fallback | confirmation panel | A wrong fact poisons every later recommendation |

---

## 4. Advice validity and invalidation

Advice is not "valid until 60 seconds pass". Each recommendation records **what it depends on**.

```mermaid
flowchart TD
    A["Advice generated<br/>stage = purchase"] --> B["Fingerprint stored<br/>{champion, ownedAugments, items, enemyItems}"]
    B --> C{"next tick:<br/>recompute fingerprint"}

    C -->|matches| D["still valid<br/>may be displayed / spoken"]
    C -->|"augment confirmed<br/>(owned changes)"| E["invalid<br/>cannot be spoken"]
    C -->|"buy one component"| F["objective / coordination advice<br/>stays valid"]
    C -->|"TTL expired"| E

    E --> G["next trigger builds fresh advice"]
```

| Stage | Depends on | TTL |
|---|---|---|
| `opening` (6-item plan) | champion **+ owned augments** | 10 min |
| `augment` (three-way choice) | champion, owned, current offers | 90 s |
| `postAugment` (how to play it) | champion, owned | 90 s |
| `death` / `purchase` | champion, phase, level band, completed items, owned, enemy items | 45 s |
| `objective` / `turret` / `ace` / `coordination` | champion, phase, alive allies, alive enemies | 45 s |

The `opening` row is the one that caused a real bug: it used to depend on champion only, so a
build order generated before the first augment survived for ten minutes — while a later single
recommendation told the player to build the very item the plan omitted.
Case study: [TECHNICAL_REPORT.md §6](TECHNICAL_REPORT.md#6-case-study-augments-that-name-items).

---

## 5. Match memory pipeline

Every finished match leaves one local record. Nothing is uploaded.

```mermaid
flowchart LR
    E["match ends<br/>phase = EndOfGame"] --> R["recordMatch(view)"]
    R --> J["readMatchLog(matchId)"]
    J --> F["authoritative facts<br/>GameEnd.Result · final KDA<br/>level · duration · multikill"]
    F --> M[("records.json<br/>memory row")]
    M --> T["exploration page<br/>timeline / memory gallery"]
    M --> B{"missing fields?"}
    B -->|yes| L["backfill (throttled 60 s)<br/>replay journal"]
    L --> M
```

| Field | Authoritative source |
|---|---|
| Win / lose | `GameEnd.Result` in the match journal |
| KDA, level | last state snapshot before `PreEndOfGame` |
| Duration | `GameEnd.EventTime` |
| 三杀 / 四杀 / 五杀 / 团灭 | `Multikill.KillStreak` and `Ace` events |
| Augments | confirmed picks only (never pending) |

![Exploration memory gallery](../tools/dsh-onboarding/welcome/advice.gif)

---

## 6. Presentation modes

```mermaid
flowchart LR
    A["advice text"] --> B{"display mode"}
    B -->|large| C["战况 page<br/>advice + timeline + chat"]
    B -->|narrow| D["one-line strip<br/>horizontal scroll"]
    B -->|subtitle| E["two rows<br/>push up"]
    B -->|collapsed| F["edge ball<br/>unread badge"]
    C --> G["WPF window<br/>always on top"]
    D --> G
    E --> G
    F --> G
```

| Mode | Height | Keeps last sentence? | Use case |
|---|---|---|---|
| Large | ~380 px | yes | Default; full advice + timeline |
| Narrow | 72 px | yes (strip) | Wants advice, not a panel |
| Subtitle | ~90 px | yes (2 rows) | Looks like game subtitles |
| Collapsed | 44 px ball | no (badge only) | Full-screen attention |

Subtitle rules: punctuation never starts a line, number tokens (`No.22`, `53.5%`, `15/6/16`) stay
whole, and only two rows are ever visible.

![Overlay modes](../tools/dsh-onboarding/welcome/overlay-modes.png)

---

## 7. Update integrity

Binaries never live in the repository. The client trusts exactly one thing: a signature.

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Release pipeline
    participant Web as Download host
    participant App as Installed client

    Dev->>Dev: build → manifest.json (per-file sha256)
    Dev->>Web: upload archive (immutable per version)
    Dev->>Dev: sign payload with Ed25519 (private key never leaves server)
    Dev->>Web: verify archive reachable, then publish index atomically
    App->>Web: GET latest.json
    Web-->>App: {payload, signature}
    App->>App: verify signature with bundled public key
    App->>Web: download archive
    App->>App: verify size + sha256 + every manifest entry
    App->>App: stage → route on next launch (never overwrite running dir)
```

| Control | Implementation |
|---|---|
| Tamper resistance | Ed25519 over the exact payload bytes; fixed official origin |
| Rollback safety | Immutable version paths + atomic index publish |
| Partial download | Size + per-file hash verification before staging |
| Failure policy | Any mismatch → keep running the old version silently |

---

## 8. Local state layout

```text
%USERPROFILE%\.jinbao-cloud-preview\
├── logs\
│   ├── lol-live-<ts>.jsonl        # one file per match: kills, items, augments, phases
│   ├── coach_broadcasts.jsonl     # every published advice + its stage
│   ├── speech.jsonl               # queued / started / completed / interrupted / discarded
│   ├── agent-activity.jsonl       # tool calls, durations, failures
│   └── overlay-mode.jsonl         # display mode changes + unhandled UI exceptions
├── exploration\records.json       # match memories + explored entries
├── overlay-diagnostics\           # overlay stdout/stderr (crash stacks)
├── diagnostics\<start>\           # per-launch diagnostics, last 10 kept
├── updates\                       # staged release, status, result
└── credentials.dpapi              # DPAPI-encrypted, per Windows user
```

Everything above is local. The diagnostics exporter redacts chat text, player names, credentials and
screenshots before producing a shareable bundle.

---

## 9. Where the difficulty actually is

```mermaid
quadrantChart
    title Effort vs player-visible impact
    x-axis "Low implementation effort" --> "High implementation effort"
    y-axis "Invisible to player" --> "Every match"
    quadrant-1 "Worth every hour"
    quadrant-2 "Cheap wins"
    quadrant-3 "Ignore"
    quadrant-4 "Dangerous time sink"
    "Augment OCR + confirmation": [0.82, 0.95]
    "Trigger selection + cooldowns": [0.55, 0.9]
    "Advice invalidation": [0.45, 0.8]
    "Augment-aware build plan": [0.6, 0.75]
    "Overlay display modes": [0.5, 0.6]
    "Speech queue + audit": [0.4, 0.45]
    "Landing page polish": [0.15, 0.1]
    "Extra analytics dashboards": [0.3, 0.1]
```

The top-left cluster is why this project exists: things that are cheap to *say* and expensive to
*get right*.

---

## 10. Reading order for new contributors

| If you want to… | Start here |
|---|---|
| Understand why a recommendation exists | `tools/dsh-coach-server/lib/lol-coaching-plan.js` |
| Change what the overlay looks like | `tools/desktop-release/overlay-ui.ps1` |
| Fix a "it said nothing" bug | `logs/coach_broadcasts.jsonl` → trigger reasoning |
| Fix a "it said the wrong thing" bug | `logs/lol-live-*.jsonl` → facts, then the prompt |
| Touch speech | `tools/cloud-desktop/speech.mjs` + `logs/speech.jsonl` |
| Touch the updater | `tools/jinbao-launcher/update.mjs` (verify before you change anything) |

> PowerShell files must be **UTF-8 with BOM** and use **only `#` comments**. A single `//` line once
> crashed the overlay on collapse — see [TECHNICAL_REPORT.md §9](TECHNICAL_REPORT.md#9-failure-modes-and-lessons).
