# M4-05a — NO-OP Verification

**Fecha:** 2026-05-20T22:24:22.117Z

## Flag

`PERSEO_CONVERSATIONAL_FLEX_ENABLED=false` (unset)

## Checks automáticos

| Check | PASS |
|-------|------|
| OFF run ×2 — snapshots + ai_state + gates + CRM (estructural) | ✅ |
| OFF run ×2 — outbound sig (mismo session_id fijo) | ✅ |
| flex_telemetry vacío con OFF | ✅ |
| flex_telemetry >0 con ON (contraste) | ✅ |

## Por escenario

### DEMAND (`DEMAND_002_FULL`)

- OFF repeat (estructural): **IDENTICAL**
- OFF repeat (outbound): **IDENTICAL**
- OFF vs ON estructural: **0** grupos
- OFF vs ON outbound: **0** turnos
- flex_telemetry OFF: `{}`
- flex_telemetry ON: `{"zone":1}`

**Final snapshot OFF:**
```json
{
  "detected_intent": "buy",
  "conversation_stage": "CRM_READY",
  "lead_flow": "demand",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": 5000000,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": true,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": false,
  "handoff_waiting_final_confirmation": true
}
```

**Final snapshot ON:**
```json
{
  "detected_intent": "buy",
  "conversation_stage": "CRM_READY",
  "lead_flow": "demand",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": 5000000,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": true,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": false,
  "handoff_waiting_final_confirmation": true
}
```

<details><summary>Turn artifacts OFF (snapshots + outbound sig)</summary>

```json
[
  {
    "turn": 1,
    "user": "Hola",
    "reply_sig": "hola, soy el asesor ia de luxetty. con gusto te ayudo. ¿buscas vender, poner en renta, comprar o rentar una propiedad?",
    "snapshot": {
      "detected_intent": null,
      "conversation_stage": "UNDERSTANDING",
      "lead_flow": null,
      "operation_type": null,
      "known_name": null,
      "known_budget": null,
      "known_zone": null,
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": null,
      "intent_type": null,
      "full_name": null,
      "budget_max": null,
      "location_text": null,
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "UNDERSTANDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 2,
    "user": "Busco casa en Cumbres",
    "reply_sig": "claro. ¿cómo te llamas?",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": null,
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 3,
    "user": "Tengo presupuesto de 5 millones",
    "reply_sig": "perfecto, con $5,000,000 podemos afinar opciones. ¿cómo te llamas?",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": 5000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": null,
      "budget_max": 5000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 4,
    "user": "Me llamo Jorge",
    "reply_sig": "perfecto, jorge. con $5,000,000 en cumbres sí vale revisar opciones contigo. ¿te parece si un asesor de luxetty te conta",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "HANDOFF_PENDING",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 5000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "REQUESTED",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 5000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "REQUESTED",
      "conversation_stage": "HANDOFF_PENDING",
      "handoff_stage": "HANDOFF_PENDING",
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 5,
    "user": "Sí, me puede contactar un asesor",
    "reply_sig": "perfecto, jorge. ya dejé anotado que un asesor de luxetty te contacte por este mismo medio. antes de cerrar por ahora, ¿",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "CRM_READY",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 5000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "ACCEPTED",
      "handoff_sent": false,
      "crm_ready": true,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": true
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 5000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "ACCEPTED",
      "conversation_stage": "CRM_READY",
      "handoff_stage": "CRM_READY",
      "crm_payload_ready": true,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  }
]
```
</details>

### OFFER (`OFFER_002`)

- OFF repeat (estructural): **IDENTICAL**
- OFF repeat (outbound): **IDENTICAL**
- OFF vs ON estructural: **0** grupos
- OFF vs ON outbound: **0** turnos
- flex_telemetry OFF: `{}`
- flex_telemetry ON: `{"zone":3,"money":2}`

**Final snapshot OFF:**
```json
{
  "detected_intent": "sell",
  "conversation_stage": "HANDOFF_READY",
  "lead_flow": "offer",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": null,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": false,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": false,
  "handoff_waiting_final_confirmation": true
}
```

**Final snapshot ON:**
```json
{
  "detected_intent": "sell",
  "conversation_stage": "HANDOFF_READY",
  "lead_flow": "offer",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": null,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": false,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": false,
  "handoff_waiting_final_confirmation": true
}
```

<details><summary>Turn artifacts OFF (snapshots + outbound sig)</summary>

```json
[
  {
    "turn": 1,
    "user": "Hola",
    "reply_sig": "hola, soy el asesor ia de luxetty. con gusto te ayudo. ¿buscas vender, poner en renta, comprar o rentar una propiedad?",
    "snapshot": {
      "detected_intent": null,
      "conversation_stage": "UNDERSTANDING",
      "lead_flow": null,
      "operation_type": null,
      "known_name": null,
      "known_budget": null,
      "known_zone": null,
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": null,
      "intent_type": null,
      "full_name": null,
      "budget_max": null,
      "location_text": null,
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "UNDERSTANDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 2,
    "user": "Quiero vender mi casa",
    "reply_sig": "para orientarte bien, ¿en qué rango aproximado está la propiedad (venta o renta)?",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": null,
      "known_zone": null,
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": null,
      "budget_max": null,
      "location_text": null,
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 3,
    "user": "Está en Cumbres",
    "reply_sig": "perfecto, registré cumbres. ¿tienes un precio en mente?",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": null,
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 4,
    "user": "Creo que vale como 8 millones",
    "reply_sig": "tomé un precio esperado de $8,000,000. ¿me compartes tu nombre?",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": null,
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 5,
    "user": "Tiene 3 recámaras",
    "reply_sig": "perfecto, te acompaño con la venta de tu propiedad. ¿me dices tu nombre?",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": null,
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 6,
    "user": "Me llamo Jorge",
    "reply_sig": "perfecto, jorge. tengo tu casa en cumbres con precio esperado de $8,000,000. ¿está habitada, rentada o libre?",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "QUALIFYING",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": "Jorge",
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "QUALIFYING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 7,
    "user": "Sí, puede contactarme un asesor",
    "reply_sig": "perfecto, jorge. ya dejé anotado que un asesor de luxetty te contacte por este mismo medio. antes de cerrar por ahora, ¿",
    "snapshot": {
      "detected_intent": "sell",
      "conversation_stage": "HANDOFF_READY",
      "lead_flow": "offer",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": null,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "ACCEPTED",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": true
    },
    "ai_state": {
      "lead_flow": "offer",
      "intent_type": "sell",
      "full_name": "Jorge",
      "budget_max": null,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "ACCEPTED",
      "conversation_stage": "HANDOFF_READY",
      "handoff_stage": "HANDOFF_READY",
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  }
]
```
</details>

### CLOSURE_REOPEN (`CLOSE_004`)

- OFF repeat (estructural): **IDENTICAL**
- OFF repeat (outbound): **IDENTICAL**
- OFF vs ON estructural: **0** grupos
- OFF vs ON outbound: **0** turnos
- flex_telemetry OFF: `{}`
- flex_telemetry ON: `{"zone":2}`

**Final snapshot OFF:**
```json
{
  "detected_intent": "buy",
  "conversation_stage": "CRM_READY",
  "lead_flow": "demand",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": 6000000,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": true,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": true,
  "handoff_waiting_final_confirmation": false
}
```

**Final snapshot ON:**
```json
{
  "detected_intent": "buy",
  "conversation_stage": "CRM_READY",
  "lead_flow": "demand",
  "operation_type": "sale",
  "known_name": "Jorge",
  "known_budget": 6000000,
  "known_zone": "Cumbres",
  "advisor_contact_consent": "ACCEPTED",
  "handoff_sent": false,
  "crm_ready": true,
  "occupancy_status": null,
  "conversation_soft_closed": false,
  "terminal_ack_close": false,
  "explicit_reopen": true,
  "handoff_waiting_final_confirmation": false
}
```

<details><summary>Turn artifacts OFF (snapshots + outbound sig)</summary>

```json
[
  {
    "turn": 1,
    "user": "Hola",
    "reply_sig": "hola, soy el asesor ia de luxetty. con gusto te ayudo. ¿buscas vender, poner en renta, comprar o rentar una propiedad?",
    "snapshot": {
      "detected_intent": null,
      "conversation_stage": "UNDERSTANDING",
      "lead_flow": null,
      "operation_type": null,
      "known_name": null,
      "known_budget": null,
      "known_zone": null,
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": null,
      "intent_type": null,
      "full_name": null,
      "budget_max": null,
      "location_text": null,
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "UNDERSTANDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 2,
    "user": "Busco casa en Cumbres presupuesto 6 millones",
    "reply_sig": "perfecto. ¿me dices tu nombre para seguir?",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "IDENTITY_PENDING",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": null,
      "known_budget": 6000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "UNKNOWN",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": null,
      "budget_max": 6000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "UNKNOWN",
      "conversation_stage": "IDENTITY_PENDING",
      "handoff_stage": null,
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 3,
    "user": "Jorge",
    "reply_sig": "perfecto, jorge. con $6,000,000 en cumbres sí vale revisar opciones contigo. ¿te parece si un asesor de luxetty te conta",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "HANDOFF_PENDING",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 6000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "REQUESTED",
      "handoff_sent": false,
      "crm_ready": false,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 6000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "REQUESTED",
      "conversation_stage": "HANDOFF_PENDING",
      "handoff_stage": "HANDOFF_PENDING",
      "crm_payload_ready": false,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 4,
    "user": "Sí, me parece bien",
    "reply_sig": "perfecto, jorge. ya dejé anotado que un asesor de luxetty te contacte por este mismo medio. antes de cerrar por ahora, ¿",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "CRM_READY",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 6000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "ACCEPTED",
      "handoff_sent": false,
      "crm_ready": true,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": true
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 6000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "ACCEPTED",
      "conversation_stage": "CRM_READY",
      "handoff_stage": "CRM_READY",
      "crm_payload_ready": true,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 5,
    "user": "Gracias",
    "reply_sig": "perfecto, jorge. gracias por contactarnos. un asesor de luxetty continuará contigo por este medio. que tengas excelente ",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "CRM_READY",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 6000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "ACCEPTED",
      "handoff_sent": false,
      "crm_ready": true,
      "occupancy_status": null,
      "conversation_soft_closed": true,
      "terminal_ack_close": true,
      "explicit_reopen": false,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 6000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "ACCEPTED",
      "conversation_stage": "CRM_READY",
      "handoff_stage": "CRM_READY",
      "crm_payload_ready": true,
      "conversation_soft_closed": true,
      "terminal_ack_close": true,
      "explicit_reopen": false,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  },
  {
    "turn": 6,
    "user": "También quiero revisar García",
    "reply_sig": "claro, jorge, retomamos. revisamos garcía. ¿buscas comprar o rentar?",
    "snapshot": {
      "detected_intent": "buy",
      "conversation_stage": "CRM_READY",
      "lead_flow": "demand",
      "operation_type": "sale",
      "known_name": "Jorge",
      "known_budget": 6000000,
      "known_zone": "Cumbres",
      "advisor_contact_consent": "ACCEPTED",
      "handoff_sent": false,
      "crm_ready": true,
      "occupancy_status": null,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": true,
      "handoff_waiting_final_confirmation": false
    },
    "ai_state": {
      "lead_flow": "demand",
      "intent_type": "buy",
      "full_name": "Jorge",
      "budget_max": 6000000,
      "location_text": "Cumbres",
      "occupancy_status": null,
      "advisor_contact_consent": "ACCEPTED",
      "conversation_stage": "CRM_READY",
      "handoff_stage": "CRM_READY",
      "crm_payload_ready": true,
      "conversation_soft_closed": false,
      "terminal_ack_close": false,
      "explicit_reopen": true,
      "v3_primary_active": true
    },
    "v3_primary_gate": {
      "allowlist_match": true,
      "argos_mode": true,
      "v3_primary_allowed": true
    }
  }
]
```
</details>

## Conclusión

Con flag **OFF**, no hay aplicación de flex (telemetría vacía) y el runtime ARGOS es **estructuralmente idéntico** en los 3 flujos (DEMAND / OFFER / CLOSURE+reopen): mismos snapshots, `ai_state`, `state_transition`, `v3_primary_gate`, cierres/reopen y CRM dry-run.

Contraste ON muestra deltas solo cuando el flag está activo (ver `flex_telemetry_on`).
