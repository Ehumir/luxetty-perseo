'use strict';

/**
 * PERSEO Commercial Coach — read-only SOC snapshot + recommendation text.
 * ATENA executes delivery via notification-dispatcher; PERSEO never sends WA to agents directly.
 */

async function getAgentSocSnapshot(supabase, userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.rpc('get_agent_soc_snapshot', { p_user_id: userId });
  if (error) {
    return null;
  }
  return data;
}

/**
 * Build humanized daily brief copy from SOC snapshot (no LLM required for MVP).
 */
function buildDailyBriefFromSnapshot(snapshot, agentName) {
  const name = agentName || 'equipo';
  const today = snapshot?.tasks_today ?? 0;
  const overdue = snapshot?.tasks_overdue ?? 0;
  const critical = snapshot?.leads_critical ?? 0;
  const waiting = snapshot?.waiting_expiring ?? 0;

  const lines = [
    `Buenos días, ${name}.`,
    `Hoy tienes ${today} tareas programadas` +
      (overdue > 0 ? ` y ${overdue} vencidas` : '') +
      '.',
  ];

  if (critical > 0) {
    lines.push(`${critical} solicitud${critical > 1 ? 'es' : ''} en riesgo — priorízalas.`);
  }
  if (waiting > 0) {
    lines.push(`${waiting} espera${waiting > 1 ? 's' : ''} por vencer pronto.`);
  }

  lines.push('Tu prioridad: revisar vencidas, luego críticas, luego el resto del día.');

  return lines.join('\n');
}

/**
 * Build EOD review copy.
 */
function buildEodReviewFromSnapshot(snapshot) {
  const pending = (snapshot?.tasks_today ?? 0) + (snapshot?.tasks_overdue ?? 0);
  const critical = snapshot?.leads_critical ?? 0;

  return (
    `Hoy quedaron ${pending} seguimientos pendientes` +
    (critical > 0 ? ` y ${critical} solicitudes críticas` : '') +
    '.\n¿Deseas reprogramarlos, cerrarlos o asignarlos? Responde desde ATENA.'
  );
}

module.exports = {
  getAgentSocSnapshot,
  buildDailyBriefFromSnapshot,
  buildEodReviewFromSnapshot,
};
