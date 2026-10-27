'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let token = null, snapshot = null, refreshing = false, providers = [], limitsLoaded = false;
function toast(message, error = false) { const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = message; $('toastRoot').append(node); setTimeout(() => node.remove(), 9000); }
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(7000) }); const value = await r.json(); if (!r.ok) throw Error(value.error || 'Request failed'); return value; }
async function action(action, extra = {}) {
  try {
    if (!token) token = (await get('/api/session')).token;
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BabyTracker-Fleet': token }, body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(60000) });
    const value = await r.json();
    if (!r.ok) { if (r.status === 403) token = null; throw Error(value.error || 'Action failed'); }
    // A restarted controller creates a fresh action token. Clear the old token
    // without replaying any mutation; the next deliberate action obtains it.
    if (action === 'restart') token = null;
    toast(value.note || (value.ok === false ? 'Operation could not be verified. Inspect the current state.' : 'Controller action recorded.'), value.ok === false);
    await refresh(); return value;
  } catch (e) { toast(e.name === 'TimeoutError' ? 'Response timed out. Refresh and inspect the controller before retrying; an action may have been submitted.' : e.message, true); throw e; }
}
function render(s) {
  snapshot = s;
  $('mode').textContent = s.mode.toUpperCase(); $('sync').textContent = 'Observed ' + new Date(s.observedAt).toLocaleTimeString();
  $('total').textContent = s.runtime.online ? s.summary.total : '—'; $('working').textContent = s.runtime.online ? s.summary.working : '—'; $('available').textContent = s.runtime.online ? s.summary.available : '—';
  $('quota').textContent = s.quota.fresh ? s.quota.remainingPercent + '%' : '—'; $('quotaNote').textContent = s.quota.fresh ? 'Shared account · current sample' : s.quota.reason;
  $('notice').textContent = !s.runtime.online ? s.runtime.reason + '. No live activity is being claimed.' : s.emergency ? 'Emergency stop: ' + s.emergency.phase + '. Remaining sessions: ' + (s.emergency.remaining ?? 'unverified') : s.dispatchBlocker || 'Bounded dispatch is enabled. The queue and run budget govern new assignments.';
  $('notice').classList.toggle('warning', !s.runtime.online || !!s.dispatchBlocker || !!s.emergency);
  $('resources').textContent = 'Free RAM: ' + s.resources.freeMemoryGiB.toFixed(1) + ' / ' + s.resources.totalMemoryGiB.toFixed(1) + ' GiB · CPU: ' + (s.resources.cpuPercent === null ? 'unavailable' : s.resources.cpuPercent + '%') + ' · Disk I/O: unavailable · Run dispatches: ' + (s.run?.dispatches ?? 0) + ' / ' + s.limits.maxDispatches;
  $('turbo').textContent = s.run?.turbo ? 'Disable Turbo' : 'Enable Turbo';
  $('rows').innerHTML = s.sessions.length ? s.sessions.map(a => '<tr><td><strong>' + esc(a.name) + '</strong><div class="subtext">' + esc(a.id) + '</div></td><td>' + esc(a.model) + '<div class="subtext">' + esc(a.harness) + (a.effort ? ' · ' + esc(a.effort) : '') + '</div></td><td><span class="state-chip ' + (a.busy ? 'active' : a.label === 'Blocked' ? 'blocked' : '') + '">' + esc(a.label) + '</span></td><td>' + (a.issue ? '<a href="https://github.com/MulattoTech/BabyTracker/issues/' + Number(a.issue) + '">Issue #' + Number(a.issue) + '</a>' : 'No reserved task') + '<div class="subtext">' + a.prs.map(p => 'PR #' + Number(p.number) + ' · ' + esc(p.ci || p.state || 'unknown')).join(', ') + '</div></td><td>' + (a.unresolvedDelivery ? 'Manual reconciliation needed' : a.cooldownSeconds ? a.cooldownSeconds + 's cooldown' : 'No reliable ETA') + '</td><td><div class="row-actions"><button class="small-action" data-session="' + esc(a.id) + '" data-op="nudge">Nudge</button><button class="small-action accent" data-session="' + esc(a.id) + '" data-op="find-work">Find Work</button><button class="small-action" data-session="' + esc(a.id) + '" data-op="plan">Model plan</button></div></td></tr>').join('') : '<tr><td colspan="6" class="empty">' + (s.runtime.online ? 'No BabyTracker sessions are registered. MJobs agents are excluded. Click Start Fleet to provision one verified BabyTracker Codex orchestrator. No worker is created merely by opening this dashboard.' : 'Orchestrator runtime is unavailable. The local controller and saved task queue remain accessible.') + '</td></tr>';
  $('tasks').innerHTML = s.tasks.length ? s.tasks.map(t => '<div class="task-item"><div><strong>' + esc(t.priority) + ' · ' + esc(t.title) + '</strong><p><a href="https://github.com/MulattoTech/BabyTracker/issues/' + Number(t.issue) + '">Requirement #' + Number(t.issue) + '</a> · ' + esc(t.status) + ' · Acceptance: ' + esc(t.acceptance) + '</p><p>' + esc(t.files.join(', ')) + '</p></div>' + (['proposed', 'queued'].includes(t.status) ? '<div><select aria-label="Assign worker" data-task="' + esc(t.id) + '"><option value="">Choose available worker</option>' + s.sessions.filter(a => a.idle).map(a => '<option value="' + esc(a.id) + '"' + (a.id === t.agentId ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select></div>' : '') + '</div>').join('') : '<div class="empty">No assigned tasks. Add a real GitHub issue with a bounded scope to propose the next useful change.</div>';
  if (!limitsLoaded) { for (const [key, value] of Object.entries(s.limits)) $('limitsForm').elements[key].value = value; limitsLoaded = true; }
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try { render(await get('/api/state')); }
  catch (e) { $('sync').textContent = 'Disconnected · snapshot stale'; $('notice').textContent = 'Controller unavailable: ' + e.message + '. Displayed values are historical until refreshed.'; $('notice').classList.add('warning'); }
  finally { refreshing = false; }
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  const name = button.dataset.action;
  if (['emergency', 'drain', 'start', 'release'].includes(name) && !confirm(({ emergency: 'Stop only BabyTracker runtime sessions now? Uncommitted files and branches are preserved.', drain: 'Ask BabyTracker workers to checkpoint and stop?', start: 'Enable this bounded BabyTracker run? If none exists, Start may provision one Codex orchestrator (which may use quota); tasks still require explicit assignment or Find Work.', release: 'Release the BabyTracker emergency latch after verifying its sessions have stopped?' })[name])) return;
  button.disabled = true; try { await action(name); } catch {} finally { button.disabled = false; }
}));
$('refresh').addEventListener('click', refresh);
$('turbo').addEventListener('click', () => action('turbo', { enabled: !snapshot?.run?.turbo }).catch(() => {}));
$('limitsForm').addEventListener('submit', async event => { event.preventDefault(); const limits = Object.fromEntries([...new FormData(event.target)].map(([k, v]) => [k, Number(v)])); await action('limits', { limits }).catch(() => {}); });
$('taskForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); try { await action('task', { task: { title: form.get('title'), issue: Number(form.get('issue')), priority: form.get('priority'), files: form.get('files').split(/\r?\n/).map(s => s.trim()).filter(Boolean) } }); event.target.reset(); } catch {} });
$('tasks').addEventListener('change', event => { const select = event.target.closest('select[data-task]'); if (select?.value) action('assign', { taskId: select.dataset.task, agentId: select.value }).catch(() => {}); });
$('rows').addEventListener('click', async event => {
  const button = event.target.closest('button[data-session]'); if (!button) return;
  if (button.dataset.op !== 'plan') return action(button.dataset.op, { id: button.dataset.session }).catch(() => {});
  try {
    providers = (await get('/api/providers')).providers.filter(p => p.available && p.models.length);
    if (!providers.length) return toast('No provider model catalog has been verified for this installation yet.', true);
    $('planAgent').value = button.dataset.session; $('planProvider').innerHTML = providers.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join(''); updateModels(); $('planDialog').showModal();
  } catch (e) { toast(e.message, true); }
});
function updateModels() { const provider = providers.find(p => p.id === $('planProvider').value); $('planModel').innerHTML = (provider?.models || []).map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join(''); updateEfforts(); }
function updateEfforts() { const model = providers.find(p => p.id === $('planProvider').value)?.models.find(m => m.id === $('planModel').value); $('planEffort').innerHTML = (model?.efforts || []).map(e => '<option>' + esc(e) + '</option>').join(''); }
$('planProvider').addEventListener('change', updateModels); $('planModel').addEventListener('change', updateEfforts);
$('savePlan').addEventListener('click', async () => { try { await action('model-plan', { id: $('planAgent').value, plan: { harness: $('planProvider').value, model: $('planModel').value, effort: $('planEffort').value, mode: 'tui' } }); $('planDialog').close(); } catch {} });
refresh(); setInterval(refresh, 8000);
