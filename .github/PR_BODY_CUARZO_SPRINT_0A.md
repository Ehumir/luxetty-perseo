# APA V1.0 Cuarzo — Sprint 0A: Operational Stabilization (Production Audit Remediation)

> **Release type:** Stabilization / closure block (not a feature release)  
> **Target version:** APA V1.0 Cuarzo  
> **Explicitly out of scope:** APA V1.1 Amatista  
> **Status after merge:** Code ready — **requires deploy + 48h prod observation + Sprint 0B** before official Cuarzo closure

---

## Summary

This PR closes the **critical operational gaps** identified in a **real production audit** of 13 WhatsApp ad-click contacts. It stabilizes **pauta/property CRM execution**, **inactivity follow-ups**, **property-owner assignment on abandonment**, **conversation reuse/dedup**, and **consultative anti-loops** — without expanding scope into Amatista capabilities.

**Tests:** `npm run test:perseo` → **115/115 PASS**

---

## Context

### Production audit — 13 real ad contacts (May 2026)

Evidence source: Supabase production (`pjoxytwsvbeoivppczdx`), documented in ATENA repo:

- [`luxetty-atena/docs/audits/CUARZO-PAUTA-AUDIT-13-CONTACTOS.md`](https://github.com/xilum/luxetty-atena/blob/main/docs/audits/CUARZO-PAUTA-AUDIT-13-CONTACTOS.md)

| Finding | Production evidence |
|---------|---------------------|
| V3 not serving real pauta | 100% `legacy` + `allowlist_no_match`; `allowlist_count: 1` |
| CRM execute blocked for pauta | e.g. `5218998722910` — 13 messages, `LUX-A0453`, **no lead**; every turn `crm_execute_allowed: false` |
| Partial CRM success | 12/13 with lead; ownership correct for A0453 when lead existed |
| Inactivity flow **not running** | 0 `followup_*` / `conversation_closed_by_inactivity` events; conversations open 150–290h |
| `isPautaConversation` incomplete | 13/13 had `campaign_context`; **0** had `whatsapp_referral` in `ai_state` |
| Abandonment lead wrong agent | Code path used **Agente Especial**, not property owner |
| Consultative loops / echo | “Listo, retomo…”, empty inbound/sticker loops, repeated price blocks |

### Why this matters

These are **paid Meta ad clicks** — users often **do not return**. PERSEO must still deliver an **operational outcome**: a traceable **lead (solicitud)** in ATENA CRM with **`interested_property_id`** and assignment to the **listing agent**, even after silence.

Without this block, APA V1.0 Cuarzo does not meet the operational contract in [`APA-OFFICIAL-VERSIONING-ROADMAP.md`](https://github.com/xilum/luxetty-atena/blob/main/docs/APA-OFFICIAL-VERSIONING-ROADMAP.md) (items 8, 9, 15, 21, 46).

### Amatista blocked

**NO-GO APA V1.1 Amatista** until:

- This PR is deployed to production
- **48 hours** stable observation
- **Sprint 0B** re-audit + KPIs + release notes + formal GO acta

---

## Problems corrected (by block)

### 1. CRM execute — controlled pauta/property bypass (NOT global)

- **New:** `conversation/pautaDetection.js` — `resolvePautaPropertyCrmContext()`, `isPautaConversation()`
- **Updated:** `config/crmExecuteInboundGate.js`
  - Allows `crm_execute` on **legacy pipeline** when:
    - Valid `property_code` / resolvable `interested_property_id`
    - `campaign_context` or property-specific commercial context
    - `PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS !== 'false'`
  - **Does NOT** bypass for generic demand without property context
- **Updated:** `index.js` — provisional contact for pauta property without requiring display name first; emits `property_pauta_lead_autocreated`

**Preserves:** assignment engine, dedup, reuse policy, all existing CRM gates for non-pauta traffic.

### 2. Pauta detection (campaign_context + referral)

- Unified detection: `whatsapp_referral`, `campaign_context`, `property_code`, property-specific intent
- `services/followupAutomation.js` delegates to `pautaDetection` (fixes 0% pauta detection on real cohort)

### 3. Inactivity flow — real execution path

- **New:** `routes/internalJobsRouter.js` → `POST /internal/jobs/inactivity-followups`
- **New:** `middleware/perseoCronAuth.js` (`PERSEO_CRON_SECRET`)
- Wired `runInactivityFollowups` to production (previously **only** `scripts/smoke-followups.js`)
- Steps unchanged: **1h → 6h → 20h → close 24h**

### 4. Property abandonment lead — property owner (not Agente Especial)

- **New:** `ensurePropertyPautaAbandonedLead()` in `services/leadAutomation.js`
- Uses official `createOrReuseLeadFromConversation` + `buildAssignmentPriorityCandidates` → **`property_owner_agent`**
- Sets `interested_property_id` when resolvable
- Deprecated path: `createPautaAbandonedLead` (special agent) — kept for compatibility, no longer called from followups

### 5. Property owner assignment

- In-thread CRM and abandonment both route through existing assignment engine
- New contact from property context: `assignment_property_owner_for_new_contact` (unchanged, now reachable for pauta bypass)

### 6. Anti-loop / anti-echo

- `conversation/antiLoopGuardrails.js` — removes generic “Listo, retomo…” template; contextual reformulation for names / property flow
- F0 hotfix: “me llamo” / name echo guardrails (included in branch)

### 7. Conversation reuse + dedup (F0 + hardened)

- `selectConversationReuseStrategy` wired in webhook (`utils/helpers.js`, `index.js`)
- Dedup fail-closed + cross-conversation duplicate skip (`services/saveConversationMessage.js`)
- V3 session hydration from `ai_state` (`conversation/v3/state/legacyToV3State.js`)

### 8. `ai_state` cleanup

- **New:** `conversation/locationSanitizer.js` — blocks non-geographic phrases from `location_text` (e.g. “favores tarde disculpa”)
- Applied in `conversation/stateUpdater.js`

### 9. ARGOS / observability events (no schema change)

| Event | Purpose |
|-------|---------|
| `property_pauta_lead_autocreated` | Lead created/reused from pauta/property CRM or abandonment |
| `property_pauta_abandoned` | Conversation closed by inactivity (pauta/property) |
| `followup_lead_recovered` | Lead ensured after inactivity close |
| `crm_execute_gate` payload extended | `pauta_property_bypass`, `crm_execute_bypass_reason` |

### 10. Cron / job infrastructure

- Internal job endpoint + auth middleware
- Structured log: `FOLLOWUP_JOB_SUMMARY`
- Kill switch: `PERSEO_INACTIVITY_FOLLOWUPS_ENABLED=false`

---

## Risks mitigated

| Risk | Mitigation |
|------|------------|
| Global CRM bypass | Only `resolvePautaPropertyCrmContext().bypassEligible` |
| Duplicate leads | Existing dedup + `createOrReuseLeadFromConversation` idempotency |
| Wrong agent | Property owner via assignment engine; special agent removed from abandonment |
| Runaway followups | WA 24h window rules preserved; batch limit; cron kill switch |
| V3 regression | Allowlist V3 path unchanged; bypass is additive |
| Fast rollback | Env flags + cron disable + redeploy previous SHA (< 15 min) |

---

## New environment variables

| Variable | Required | Default behavior | Purpose |
|----------|----------|------------------|---------|
| `PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS` | Recommended prod: `true` | ON unless set to `false` | Controlled CRM bypass for pauta/property only |
| `PERSEO_INACTIVITY_FOLLOWUPS_ENABLED` | Recommended prod: `true` | ON unless `false` | Master switch for inactivity job |
| `PERSEO_CRON_SECRET` | **Required** for cron | — | Auth for `POST /internal/jobs/inactivity-followups` |
| `PERSEO_FOLLOWUP_BATCH_LIMIT` | Optional | `100` | Max conversations per cron tick |

Existing flags unchanged: `PERSEO_V3_ENABLED`, `PERSEO_V3_CRM_EXECUTE`, `PERSEO_V3_QA_ALLOWLIST`.

---

## Deploy checklist (post-merge)

### A. Pre-deploy

- [ ] PR reviewed and approved (this PR + ATENA docs PR if split)
- [ ] CI green: `npm run test:perseo` (115 tests)
- [ ] `node scripts/perseo-v1-preflight.js --phase f1` on staging

### B. Staging

- [ ] Deploy PERSEO staging from `main`
- [ ] Set env vars (see above)
- [ ] Configure Railway Cron → `POST /internal/jobs/inactivity-followups` every **15 min**
- [ ] `node scripts/smoke-followups.js` (staging)
- [ ] Manual WA smoke S1 (pauta A0453, number **outside** allowlist)

### C. Production

- [ ] Deploy PERSEO prod — **1 replica** initially
- [ ] Enable env vars + cron (verify `FOLLOWUP_JOB_SUMMARY` in logs within 30 min)
- [ ] Confirm `PERSEO_CRM_EXECUTE=true`
- [ ] Monitor 48h: `crm_creation_failed`, duplicate leads, followup events

### D. Documentation (ATENA repo)

- [ ] Merge companion docs PR (audits, deploy runbook, roadmap pointer)
- [ ] Link deploy SHA in `CUARZO-V1-CLOSURE-HOTFIX.md`

**Runbook:** `luxetty-atena/docs/audits/CUARZO-SPRINT-0A-DEPLOY-RUNBOOK.md`

---

## Smoke checklist (S1–S7)

| ID | Scenario | Pass criteria |
|----|----------|---------------|
| **S1** | Pauta click A0453, legacy, **off allowlist** | `crm_execute_allowed: true` + `crm_execute_bypass_reason: pauta_property`; `property_pauta_lead_autocreated`; lead with `interested_property_id`; agent = property owner |
| **S2** | Generic demand off allowlist (no property) | CRM **still blocked** (`allowlist_no_match`) |
| **S3** | Cron tick (staging) | `FOLLOWUP_JOB_SUMMARY` in logs; eligible conv gets `followup_1h_sent` |
| **S4** | Silence → 24h close (test conv) | `conversation_closed_by_inactivity` + `property_pauta_abandoned` + `followup_lead_recovered` if no prior lead |
| **S5** | Same phone re-inbound | Single open conversation reused (no duplicate conv) |
| **S6** | Duplicate WAMID webhook | One `conversation_messages` row; no double processing |
| **S7** | “Me llamo Jorge” / name inbound | No “Listo, retomo…” echo; contextual reply |

---

## Rollback checklist

1. [ ] `PERSEO_INACTIVITY_FOLLOWUPS_ENABLED=false`
2. [ ] `PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS=false`
3. [ ] Disable Railway Cron job
4. [ ] Redeploy previous known-good Railway release SHA
5. [ ] Verify: no new `property_pauta_*` events; CRM returns to pre-deploy behavior
6. [ ] Post-mortem note in Sprint 0B doc if rollback triggered

**Target time:** < 15 minutes.

---

## Expected KPIs (validated in Sprint 0B — not at merge time)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Pauta/property conversations → valid lead | **≥ 95%** (7d cohort) | SQL `conversations` + `leads` |
| Ownership (lead agent = property agent when `interested_property_id`) | **≥ 98%** | SQL join `properties` |
| Property abandonment without lead | **0%** | Cohort D in 0B plan |
| Followups executed (eligible >1h silence) | **≥ 90%** with `followup_1h_sent` | `conversation_events` |
| `crm_creation_failed` (7d rolling) | **0** | Events |
| Consultative loops (same outbound 3×) | **< 1%** sample | Transcript audit |
| `fallback_consultive` on pauta | Baseline documented; must not worsen | Telemetry |

---

## APA Roadmap alignment

This PR advances **implementation** toward closing Cuarzo items:

| Item | Capability | PR contribution | Official ✅ still requires |
|------|------------|-----------------|---------------------------|
| **8** | Durable session | V3 hydrate from `ai_state` | 48h prod + 0B smoke |
| **9** | Dedup atomic | Fail-closed + 23505 | 0B SQL verification |
| **15** | CRM execute prod | Pauta/property bypass + gates | 0B cohort re-test |
| **21** | Fail-closed policy | Unchanged; preflight smoke | 0B policy smoke |
| **46** | GO real pauta | CRM + followups + ownership path | 0B acta + release notes |

### NOT closed by merge alone

- [ ] 48h production stability
- [ ] Sprint **0B** re-audit (13 phones + new 7d cohort)
- [ ] KPI thresholds met
- [ ] `APA-V1.0-CUARZO-RELEASE-NOTES.md`
- [ ] Formal GO acta → tag `apa-v1.0.0`

---

## Explicitly NOT included (deferred to Amatista+)

- APA V1.1 Amatista features (flex ON prod, read states, triage 4B, SLA takeover)
- Advanced multimodal (Ágata)
- Realtime inbox / advanced queue
- Omnichannel
- Large refactors (V3 primary rollout to full pauta — optional pilot remains separate decision)
- ATENA panel UI changes (timeline labels optional in 0B)
- **No schema migrations** in this PR

---

## Files changed (PERSEO)

### New

- `conversation/pautaDetection.js`
- `conversation/locationSanitizer.js`
- `conversation/v3/state/legacyToV3State.js`
- `routes/internalJobsRouter.js`
- `middleware/perseoCronAuth.js`
- `test/pautaDetection.test.js`
- `test/legacyToV3State.test.js`

### Modified (core)

- `config/crmExecuteInboundGate.js`
- `index.js`
- `services/followupAutomation.js`
- `services/leadAutomation.js`
- `services/saveConversationMessage.js`
- `conversation/antiLoopGuardrails.js`
- `conversation/stateUpdater.js`
- `config/perseoV3Flags.js` (strict allowlist)
- `package.json` (test suite)
- `test/crmExecuteInboundGate.test.js`
- (+ F0 wiring: v3 runtime, reuse tests, `utils/text.js`)

---

## Evidence & references

| Artifact | Location |
|----------|----------|
| **Tests 115/115 PASS** | `npm run test:perseo` (includes `test/pautaDetection.test.js`, `test/crmExecuteInboundGate.test.js`) |
| Production audit (13 phones) | `luxetty-atena/docs/audits/CUARZO-PAUTA-AUDIT-13-CONTACTOS.md` |
| Sprint 0A/0B technical plan | `luxetty-atena/docs/audits/CUARZO-SPRINT-0A-0B-TECHNICAL-PLAN.md` |
| Hotfix + 0A changelog | `luxetty-atena/docs/audits/CUARZO-V1-CLOSURE-HOTFIX.md` |
| Stabilization plan | `luxetty-atena/docs/audits/CUARZO-V1-STABILIZATION-PLAN.md` |
| Deploy / smoke / rollback | `luxetty-atena/docs/audits/CUARZO-SPRINT-0A-DEPLOY-RUNBOOK.md` |
| APA official roadmap | `luxetty-atena/docs/APA-OFFICIAL-VERSIONING-ROADMAP.md` |

### Cohort phones (re-audit in 0B)

`5218124691661`, `5218116901501`, `5218110169457`, `5218998722910`, `5218180644849`, `5218135784317`, `5212292088420`, `5218131262193`, `5218180150933`, `5214425971468`, `5218118210148`, `5218713166868`, `5216563561148`

---

## Reviewer focus

1. **Bypass scope** — confirm `resolvePautaPropertyCrmContext` cannot enable CRM for generic demand off allowlist.
2. **Cron auth** — `PERSEO_CRON_SECRET` required; endpoint not public without header.
3. **Abandonment** — `ensurePropertyPautaAbandonedLead` never assigns Agente Especial when property resolves.
4. **No `public.requests`** — all writes via `public.leads` only.
5. **Regression** — allowlist V3 path unchanged for QA numbers.

---

## Companion PR (recommended)

**Repo:** `luxetty-atena` — docs-only PR for audits, deploy runbook, roadmap status (no runtime code required for 0A deploy).

---

*Prepared for official Cuarzo Sprint 0A review. Do not merge until Eng + QA + Product sign-off on deploy plan.*
