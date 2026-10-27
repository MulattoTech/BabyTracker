'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { DispatchLedger } = require('./vendor/mjobs/dispatch-ledger');
const { instruction } = require('./vendor/mjobs/find-work');
const { validateSelection } = require('./vendor/mjobs/provider-catalog');
const { PROJECT, SOURCE_REPO, ISSUE_REPO } = require('./config');

function writeJSON(file, value) {
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function active(s) { return !s.isTerminated && !['exited', 'terminated', 'stopped'].includes(s.activity?.state || s.activity || s.status); }
function idle(s) { return (s.activity?.state || s.activity) === 'idle' && !s.isTerminated; }
function busy(s) { return ['active', 'working'].includes(s.activity?.state || s.activity); }

class FleetController {
  constructor(config, { adapter, quota, providers = async () => ({ providers: [] }), now = Date.now, resources = () => ({ freeMemoryGiB: os.freemem() / 1073741824, totalMemoryGiB: os.totalmem() / 1073741824, cpuPercent: null, diskIO: null }) }) {
    if (config.projectId !== PROJECT || config.sourceRepository !== SOURCE_REPO || config.issueRepository !== ISSUE_REPO) throw Error('BabyTracker project identity is fixed');
    this.config = config; this.adapter = adapter; this.quotaReader = quota; this.providers = providers; this.now = now; this.resources = resources;
    fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    this.file = path.join(config.stateDir, 'controller.json');
    this.auditFile = path.join(config.stateDir, 'audit.jsonl');
    this.ledger = new DispatchLedger({ root: config.stateDir, now });
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw Error('Controller state is unreadable; preserving it and refusing to start'); }
    if (!this.state) this.state = { schema: 1, projectId: PROJECT, sourceRepository: SOURCE_REPO, issueRepository: ISSUE_REPO, mode: 'paused', generation: 0, tasks: [], plans: {}, run: null, limits: { concurrency: 2, maxDispatches: 8, maxMinutes: 60, minimumRemainingPercent: 20, minimumFreeMemoryGiB: 4 }, emergency: null };
    if (this.state.schema !== 1 || this.state.projectId !== PROJECT || this.state.sourceRepository !== SOURCE_REPO || this.state.issueRepository !== ISSUE_REPO || !Array.isArray(this.state.tasks)) throw Error('Controller state identity/schema mismatch');
    // A dashboard restart never resumes paid work, uncertain deliveries, or old automation.
    if (this.state.mode !== 'emergency') this.state.mode = 'paused';
    this.state.generation++; this.state.run = null;
    this.state.recoveredAt = new Date(now()).toISOString();
    this.save(); this.audit('controller_started', { mode: this.state.mode });
    this.mutating = false; this.tickRunning = false; this.lastSnapshot = null; this.nextDispatchAt = null;
  }
  save() { writeJSON(this.file, this.state); }
  audit(event, details = {}) { fs.appendFileSync(this.auditFile, JSON.stringify({ at: new Date(this.now()).toISOString(), projectId: PROJECT, event, ...details }) + '\n', { mode: 0o600 }); }
  async sessions() {
    const all = await this.adapter.sessions();
    if (!Array.isArray(all)) throw Error('Invalid runtime sessions');
    return all.filter(s => s.projectId === PROJECT);
  }
  quota() { return this.quotaReader(); }
  guard({ requireRunning = true, session = null } = {}) {
    if (this.state.mode === 'emergency') return 'BabyTracker emergency stop is latched';
    if (requireRunning && this.state.mode !== 'running') return 'Fleet is paused';
    if (!this.config.runtimeVerified) return 'BabyTracker Orchestrator project/repository binding is not yet verified';
    if (session && session.harness !== 'codex') return 'Provider-specific budget telemetry has not been verified for this harness';
    const q = this.quota();
    if (!q.fresh || q.remainingPercent === null) return q.reason || 'Fresh Codex quota is required';
    if (q.remainingPercent <= this.state.limits.minimumRemainingPercent) return 'Configured remaining-quota threshold reached';
    if (this.resources().freeMemoryGiB < this.state.limits.minimumFreeMemoryGiB) return 'Below configured free-memory threshold';
    const run = this.state.run;
    if (requireRunning && !run) return 'No bounded run is active';
    if (requireRunning && run && (run.dispatches >= this.state.limits.maxDispatches || this.now() >= run.deadline)) return 'Configured run budget is exhausted';
    return null;
  }
  async snapshot() {
    let sessions = [], runtime = { online: true, reason: null };
    try { sessions = await this.sessions(); } catch (e) { runtime = { online: false, reason: e.message }; }
    const now = this.now();
    const rows = sessions.map(s => {
      const task = this.state.tasks.find(t => t.agentId === s.id && !['accepted', 'cancelled'].includes(t.status));
      const reservation = this.ledger.entries[s.id];
      const ambiguous = reservation && ['reserved', 'uncertain'].includes(reservation.status);
      const cooldown = reservation && !ambiguous ? Math.max(0, reservation.at + this.ledger.cooldownMs - now) : 0;
      let label = 'Blocked';
      if (busy(s)) label = /review/i.test(s.displayName || '') ? 'Reviewing' : 'Actively Working';
      else if (!active(s)) label = 'Paused';
      else if (ambiguous) label = 'Blocked';
      else if (this.state.mode !== 'running') label = 'Paused';
      else if (task?.dependencies?.some(id => !this.state.tasks.some(t => t.id === id && t.status === 'accepted'))) label = 'Waiting on Dependency';
      else if (cooldown > 0) label = 'Cooldown';
      else if (idle(s)) label = 'Available for Dispatch';
      return { id: s.id, projectId: PROJECT, name: s.displayName || s.id, kind: s.kind || 'worker', harness: s.harness || 'unknown', model: s.model || 'unknown', effort: s.effort || null, label, busy: busy(s), idle: idle(s), taskId: task?.id || null, issue: task?.issue || null, prs: (s.prs || []).map(p => ({ number: p.number, state: p.state, ci: p.ci, url: typeof p.url === 'string' && p.url.startsWith('https://github.com/' + SOURCE_REPO + '/') ? p.url : null })), cooldownSeconds: Math.ceil(cooldown / 1000), dispatchEta: cooldown > 0 ? new Date(now + cooldown).toISOString() : null, unresolvedDelivery: !!ambiguous, tokens: null, turnStatistics: null, lastActivity: s.activity?.timestamp || null };
    });
    const result = { observedAt: new Date(now).toISOString(), projectId: PROJECT, sourceRepository: SOURCE_REPO, issueRepository: ISSUE_REPO, mode: this.state.mode, runtime, sessions: rows, tasks: this.state.tasks, plans: this.state.plans, limits: this.state.limits, run: this.state.run, quota: this.quota(), resources: this.resources(), dispatchBlocker: this.guard(), emergency: this.state.emergency, summary: { total: rows.length, working: rows.filter(x => x.busy).length, available: rows.filter(x => x.label === 'Available for Dispatch').length, blocked: rows.filter(x => x.label === 'Blocked').length }, acceptance: { status: 'NOT_ASSESSED', percent: null, note: 'Task completion is separate from requirement acceptance; no acceptance evidence has been imported.' }, capabilities: { scopedControl: true, persistentQueue: true, boundedDispatch: true, independentReviewGate: true, modelPlans: true, modelReplacement: false, firstCodexBootstrap: typeof this.adapter.provisionCodex === 'function', dynamicProvisioning: false, geminiBudget: false, diskIO: false, perAgentTokens: false } };
    this.lastSnapshot = result; return result;
  }
  async serial(fn) {
    if (this.mutating) throw Error('Another controller action is running; refresh before trying again');
    this.mutating = true;
    try { return await fn(); } finally { this.mutating = false; }
  }
  async start() {
    return this.serial(async () => {
      if (this.state.mode === 'running') throw Error('Pause before explicitly starting a new bounded run');
      if (this.state.mode === 'draining') throw Error('Graceful shutdown is still in progress; wait for it to finish');
      const blocker = this.guard({ requireRunning: false }); if (blocker) throw Error(blocker);
      // A persistent pending/uncertain bootstrap must be reconciled before any
      // new CLI spawn. A failed/slow response may already have created a worker.
      if (Object.values(this.ledger.entries).some(r => ['reserved', 'uncertain'].includes(r.status))) throw Error('Unresolved delivery requires manual reconciliation before startup');
      const generation = this.state.generation;
      let sessions = await this.sessions();
      let createdSessionId = null;
      if (!sessions.some(s => active(s) && s.harness === 'codex')) {
        if (['pending', 'uncertain'].includes(this.state.bootstrap?.status)) throw Error('An earlier Codex bootstrap has unverified delivery. Inspect AO sessions before retrying.');
        if (typeof this.adapter.provisionCodex !== 'function') throw Error('No verified BabyTracker Codex session exists; provisioning adapter is unavailable.');
        let provisioned;
        try {
          provisioned = await this.adapter.provisionCodex(() => {
            if (generation !== this.state.generation || this.state.mode === 'emergency') throw Error('Start was interrupted before provisioning');
            this.state.bootstrap = { status: 'pending', startedAt: new Date(this.now()).toISOString() };
            this.save(); this.audit('codex_bootstrap_submitting');
          });
          if (!provisioned || typeof provisioned.id !== 'string') throw Error('Provisioner returned no session identity');
          createdSessionId = provisioned.created ? provisioned.id : null;
          this.state.bootstrap = { status: 'verified', sessionId: provisioned.id, verifiedAt: new Date(this.now()).toISOString() };
          this.save(); this.audit('codex_bootstrap_verified', { sessionId: provisioned.id, created: !!provisioned.created });
          sessions = await this.sessions();
          if (generation === this.state.generation && this.state.mode !== 'emergency' && !sessions.some(s => s.id === provisioned.id && active(s) && s.harness === 'codex')) {
            throw Error('The provisioned BabyTracker session is no longer live');
          }
        } catch (error) {
          if (this.state.bootstrap?.status === 'pending' || (this.state.bootstrap?.status === 'verified' && createdSessionId)) {
            this.state.bootstrap = { status: 'uncertain', at: new Date(this.now()).toISOString() };
            this.save(); this.audit('codex_bootstrap_unverified', { reason: String(error.message).slice(0, 180) });
            throw Error('Codex bootstrap delivery is unverified. Inspect AO sessions before retrying: ' + error.message);
          }
          throw error;
        }
      }
      if (generation !== this.state.generation || this.state.mode === 'emergency') {
        if (this.state.mode === 'emergency' && createdSessionId && sessions.some(s => s.id === createdSessionId && active(s))) {
          try { await this.adapter.command('kill', createdSessionId); }
          catch (error) {
            if (this.state.emergency) { this.state.emergency.phase = 'unverified'; this.save(); }
            this.audit('codex_bootstrap_emergency_exit_unverified', { reason: String(error.message).slice(0, 180) });
          }
        }
        throw Error('Start superseded by a stop; dispatch remains disabled');
      }
      const freshBlocker = this.guard({ requireRunning: false }); if (freshBlocker) throw Error(freshBlocker);
      this.state.mode = 'running'; this.state.generation++;
      this.state.run = { id: randomUUID(), startedAt: new Date(this.now()).toISOString(), deadline: this.now() + this.state.limits.maxMinutes * 60000, dispatches: 0, turbo: false };
      this.save(); this.audit('fleet_started', { runId: this.state.run.id });
      return { ok: true, note: createdSessionId ? 'One verified BabyTracker Codex orchestrator was created. Bounded dispatch is enabled; no task was automatically sent.' : 'Bounded dispatch enabled using an existing BabyTracker Codex session. No task was sent by Start Fleet.' };
    });
  }
  pause(reason = 'User paused dispatch') {
    if (this.state.mode === 'emergency') return { ok: true, note: 'Emergency stop stays latched; its shutdown verification continues.' };
    if (this.state.mode !== 'emergency') this.state.mode = 'paused';
    this.state.generation++; if (this.state.run) this.state.run.turbo = false;
    this.nextDispatchAt = null; this.save(); this.audit('fleet_paused', { reason });
    return { ok: true, note: 'New assignments paused; active turns were preserved.' };
  }
  async stop(emergency) {
    if (!emergency && this.state.mode === 'emergency') return { ok: true, note: 'Emergency stop stays latched. Verify shutdown and explicitly release it before other lifecycle changes.' };
    if (!emergency && this.state.mode === 'draining') return { ok: true, note: 'Graceful shutdown is already in progress.' };
    // Stop fencing happens synchronously before any awaited network operation.
    this.state.mode = emergency ? 'emergency' : 'draining'; this.state.generation++;
    const generation = this.state.generation;
    if (this.state.run) this.state.run.turbo = false;
    if (emergency) this.state.emergency = { at: new Date(this.now()).toISOString(), phase: 'requested', remaining: null, results: [] };
    this.save(); this.audit(emergency ? 'emergency_latched' : 'graceful_stop_requested');
    let sessions;
    try { sessions = await this.sessions(); }
    catch (e) {
      if (emergency && generation === this.state.generation) { this.state.emergency.phase = 'unverified'; this.state.emergency.reason = e.message; this.save(); }
      return { ok: false, note: 'Dispatch is stopped; runtime termination could not be verified.', error: e.message };
    }
    const results = [];
    for (const s of sessions.filter(active)) {
      if (generation !== this.state.generation) return { ok: false, note: 'A newer lifecycle action superseded this stop request.' };
      try {
        const action = emergency ? 'kill' : idle(s) ? 'exit' : 'send';
        await this.adapter.command(action, s.id, 'GRACEFUL WIND-DOWN ORDER FROM USER: stop delegating new work, finish or checkpoint your current BabyTracker task, preserve branches and uncommitted files, then exit. Do not restart until explicitly requested.', () => { if (generation !== this.state.generation) throw Error('A newer lifecycle action superseded this stop request'); });
        results.push({ id: s.id, action, status: 'submitted' });
      } catch (e) { results.push({ id: s.id, status: 'unverified', error: e.message }); }
    }
    if (emergency) {
      let remaining = null;
      try { remaining = (await this.sessions()).filter(active).length; } catch {}
      if (generation !== this.state.generation) return { ok: false, note: 'A newer lifecycle action superseded this stop request.' };
      this.state.emergency = { ...this.state.emergency, phase: remaining === 0 ? 'verified_stopped' : 'unverified', remaining, results }; this.save();
    }
    this.audit(emergency ? 'emergency_results' : 'graceful_results', { results });
    return { ok: results.every(r => r.status === 'submitted'), results, note: 'Only verified BabyTracker sessions were targeted. Submission is not proof of process exit.' };
  }
  async releaseEmergency() {
    if (this.state.mode !== 'emergency') throw Error('No emergency stop is latched');
    const generation = this.state.generation;
    const sessions = await this.sessions();
    if (generation !== this.state.generation) throw Error('Emergency state changed; no release performed');
    if (sessions.some(active)) throw Error('BabyTracker runtime shutdown is not yet verified');
    this.state.mode = 'paused'; this.state.generation++; this.state.emergency = null; this.save();
    this.audit('emergency_released'); return { ok: true, note: 'Emergency latch released; dispatch stays paused.' };
  }
  limits(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Limits object required');
    const ranges = { concurrency: [1, 32], maxDispatches: [1, 1000], maxMinutes: [1, 720], minimumRemainingPercent: [1, 99], minimumFreeMemoryGiB: [1, 128] };
    for (const [key, value] of Object.entries(input)) if (!ranges[key] || !Number.isInteger(value) || value < ranges[key][0] || value > ranges[key][1]) throw Error('Invalid limit: ' + key);
    if (this.state.mode === 'running') throw Error('Pause before changing a run budget');
    this.state.limits = { ...this.state.limits, ...input }; this.save(); this.audit('limits_changed', input); return this.state.limits;
  }
  enqueue(input) {
    if (!input || typeof input.title !== 'string' || input.title.trim().length < 5 || input.title.length > 200 || !Number.isSafeInteger(input.issue) || input.issue < 1) throw Error('Task needs a title and existing positive issue number');
    if (this.state.tasks.some(t => t.issue === input.issue && !['accepted', 'cancelled'].includes(t.status))) throw Error('This issue already has an unfinished task');
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 100 || input.files.some(f => typeof f !== 'string' || !f || f.length > 200 || f.includes('..') || /[\\*?\x00-\x1f]/.test(f) || f.startsWith('/') || /^[A-Za-z]:/.test(f))) throw Error('Task requires bounded repository-relative file scopes');
    const dependencies = input.dependencies || [];
    if (!Array.isArray(dependencies) || dependencies.some(id => !this.state.tasks.some(t => t.id === id))) throw Error('Unknown dependency');
    const files = [...new Set(input.files.map(f => path.posix.normalize(f).replace(/\/$/, '')))];
    if (files.some(f => !f || f === '.')) throw Error('A repository-wide file claim is not a bounded task scope');
    const task = { id: randomUUID(), title: input.title.trim(), issue: input.issue, priority: ['P0', 'P1', 'P2'].includes(input.priority) ? input.priority : 'P1', files, dependencies, status: 'proposed', agentId: null, createdAt: new Date(this.now()).toISOString(), acceptance: 'NOT_ASSESSED' };
    this.state.tasks.push(task); this.save(); this.audit('task_proposed', { id: task.id, issue: task.issue }); return task;
  }
  async assign(taskId, agentId) {
    return this.serial(async () => {
      const task = this.state.tasks.find(t => t.id === taskId); if (!task || !['proposed', 'queued'].includes(task.status)) throw Error('Only a proposed/queued task can be assigned');
      const sessions = await this.sessions(); const s = sessions.find(x => x.id === agentId);
      if (!s || !idle(s)) throw Error('Assignment requires an idle BabyTracker session');
      if (this.state.tasks.some(t => t.id !== task.id && t.agentId === agentId && !['accepted', 'cancelled'].includes(t.status))) throw Error('Agent already owns an unfinished task');
      if (this.state.tasks.some(t => t.id !== task.id && t.agentId && !['accepted', 'cancelled'].includes(t.status) && t.files.some(f => task.files.some(g => f === g || f.startsWith(g + '/') || g.startsWith(f + '/'))))) throw Error('File ownership overlaps another unfinished task');
      task.agentId = agentId; task.status = 'queued'; this.save(); this.audit('task_assigned', { taskId, agentId }); return task;
    });
  }
  async dispatch(id, kind = 'find-work') {
    return this.serial(async () => {
      const generation = this.state.generation;
      let blocker = this.guard(); if (blocker) throw Error(blocker);
      const sessions = await this.sessions(), s = sessions.find(x => x.id === id);
      if (!s || !idle(s)) throw Error('Only an idle BabyTracker agent can receive a new bounded instruction');
      blocker = this.guard({ session: s }); if (blocker) throw Error(blocker);
      if (this.occupiedSlots(sessions).size >= this.state.limits.concurrency) throw Error('Concurrency target reached; pending submissions count until runtime state settles');
      const primary = sessions.find(x => x.kind === 'orchestrator' && active(x))?.id || 'the BabyTracker integration owner';
      const task = this.state.tasks.find(t => t.agentId === id && t.status === 'queued');
      if (task?.dependencies.some(dep => !this.state.tasks.some(t => t.id === dep && t.status === 'accepted'))) throw Error('Task is waiting on an accepted dependency');
      const prefix = 'PROJECT BOUNDARY: BabyTracker ONLY. Source repo ' + SOURCE_REPO + '; requirement issues ' + ISSUE_REPO + '. Preserve production infant data. Never touch MJobs queues, worktrees, services, budgets, credentials, or global process controls. Use synthetic test data. No live deployment, unreviewed merge, or paid service activation. ';
      const message = prefix + (kind === 'nudge'
        ? 'Report only your current issue, progress, PR/CI blocker and next bounded action. Do not start unrelated work.'
        : task
          ? 'Assigned requirement ' + ISSUE_REPO + '#' + task.issue + ': ' + task.title + '. Exclusive file scope: ' + task.files.join(', ') + '. Read and verify the issue acceptance criteria before changing code. Implement a bounded slice and provide tests and independent-review evidence; do not mark acceptance complete yourself.'
          : instruction({ ...s, isIdle: true }, primary).message);
      if (generation !== this.state.generation) throw Error('Dispatch superseded by a stop');
      const reserved = this.ledger.reserve(id, message);
      this.state.run.dispatches++; if (task && kind !== 'nudge') task.status = 'dispatching'; this.save();
      try {
        await this.adapter.command('send', id, message, current => {
          if (generation !== this.state.generation) throw Error('Dispatch superseded by a stop');
          if (current && (current.projectId !== PROJECT || !idle(current) || current.harness !== 'codex')) throw Error('Current runtime identity/activity changed before submission');
          const reason = this.guard({ session: s });
          // This reservation already consumes one dispatch; allow exactly the final unit.
          if (reason && !(reason === 'Configured run budget is exhausted' && this.state.run?.dispatches === this.state.limits.maxDispatches && this.now() < this.state.run.deadline)) throw Error(reason);
        });
        this.ledger.finish(id, reserved.id, 'submitted'); if (task && kind !== 'nudge') task.status = 'submitted'; this.save();
        this.audit('dispatch_submitted', { sessionId: id, taskId: task?.id || null, kind });
        return { ok: true, status: 'submitted', note: 'Instruction submitted; completion must be independently verified.' };
      } catch (e) {
        this.ledger.finish(id, reserved.id, 'uncertain'); if (task && kind !== 'nudge') task.status = 'reconciliation_required'; this.save();
        this.audit('dispatch_uncertain', { sessionId: id });
        throw Error('Delivery is unverified and will not be automatically retried: ' + e.message);
      }
    });
  }
  async allHands() {
    const sessions = await this.sessions(); const results = [];
    for (const s of sessions.filter(idle)) {
      if (this.guard()) break;
      try { results.push({ id: s.id, ...(await this.dispatch(s.id)) }); }
      catch (e) { results.push({ id: s.id, ok: false, error: e.message }); }
      // Count submitted turns too: the daemon may not yet reflect their activity.
      if (results.filter(r => r.ok).length >= this.state.limits.concurrency) break;
    }
    return { results, note: 'One bounded pass; no new agents were provisioned.' };
  }
  occupiedSlots(sessions) {
    const occupied = new Set(sessions.filter(busy).map(s => s.id));
    for (const s of sessions.filter(active)) {
      const reservation = this.ledger.entries[s.id];
      if (reservation && (['reserved', 'uncertain'].includes(reservation.status) || this.now() - reservation.at < this.ledger.cooldownMs)) occupied.add(s.id);
    }
    return occupied;
  }
  async savePlan(id, input) {
    const sessions = await this.sessions(); if (!sessions.some(s => s.id === id && !s.isTerminated)) throw Error('Unknown BabyTracker session');
    const selection = validateSelection(input, await this.providers());
    this.state.plans[id] = { ...selection, status: 'staged', at: new Date(this.now()).toISOString() }; this.save();
    this.audit('model_plan_staged', { id, harness: selection.harness, model: selection.model });
    return { ok: true, note: 'Plan saved. Runtime replacement is not implemented; the running model was not changed.' };
  }
  turbo(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Turbo state must be boolean');
    const blocker = this.guard(); if (enabled && blocker) throw Error(blocker);
    if (!this.state.run) throw Error('Start a bounded run before enabling Turbo');
    this.state.run.turbo = enabled; this.nextDispatchAt = enabled ? this.now() : null; this.save();
    this.audit('turbo_changed', { enabled }); return { enabled };
  }
  async tick() {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      if (this.state.mode === 'draining') {
        const generation = this.state.generation;
        const sessions = await this.sessions();
        if (this.state.mode !== 'draining' || generation !== this.state.generation) return;
        for (const s of sessions.filter(idle)) {
          await this.adapter.command('exit', s.id, undefined, () => { if (this.state.mode !== 'draining' || generation !== this.state.generation) throw Error('Graceful shutdown superseded'); });
        }
        if (this.state.mode === 'draining' && generation === this.state.generation && !sessions.some(active)) { this.state.mode = 'paused'; this.save(); this.audit('graceful_stop_verified'); }
      } else if (this.state.mode === 'running') {
        const reason = this.guard();
        if (reason) { this.pause(reason); return; }
        if (this.state.run?.turbo && this.now() >= (this.nextDispatchAt || 0)) {
          this.nextDispatchAt = this.now() + 120000;
          // Automatic mode only dispatches explicitly assigned queue entries.
          // It never invents or repeatedly requests new work when the queue is empty.
          const tasks = this.state.tasks.filter(t => t.status === 'queued' && t.agentId).sort((a, b) => a.priority.localeCompare(b.priority));
          for (const t of tasks.slice(0, this.state.limits.concurrency)) {
            if (this.guard()) break;
            try { await this.dispatch(t.agentId); } catch (e) { this.audit('automatic_dispatch_blocked', { taskId: t.id, reason: e.message }); }
          }
          if (!tasks.length) this.pause('No assigned, useful queue work remains');
        }
      }
    } catch (e) { this.audit('tick_failed', { reason: e.message }); if (this.state.mode === 'running') this.pause('Runtime unavailable; dispatch paused'); }
    finally { this.tickRunning = false; }
  }
}

module.exports = { FleetController, writeJSON, active, busy, idle };
