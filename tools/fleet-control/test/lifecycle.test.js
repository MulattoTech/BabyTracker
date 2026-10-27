'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createSupervisor } = require('../run');

function fixture() {
  const children = [], scheduled = [], cancelled = [];
  const supervisor = createSupervisor({ forkChild: (...args) => { const child = new EventEmitter(); child.args = args; child.kills = []; child.kill = signal => child.kills.push(signal); children.push(child); return child; }, schedule: fn => { scheduled.push(fn); return scheduled.length; }, cancel: id => cancelled.push(id), log: () => {} });
  supervisor.start(); return { supervisor, children, scheduled, cancelled };
}
test('supervisor stop during crash backoff cancels pending restart and fences late callbacks', () => {
  const f = fixture(); f.children[0].emit('exit', 1); assert.equal(f.scheduled.length, 1);
  f.supervisor.stop(); assert.deepEqual(f.cancelled, [1]);
  f.scheduled[0](); assert.equal(f.children.length, 1); assert.deepEqual(f.children[0].kills, ['SIGTERM']);
});
test('only a requested restart replaces the owned child immediately', () => {
  const f = fixture(); f.children[0].emit('message', { type: 'babytracker-restart' }); f.children[0].emit('exit', 75);
  assert.equal(f.children.length, 2); assert.equal(f.scheduled.length, 0);
  assert.equal(f.children[1].args[2].windowsHide, true); f.supervisor.stop(); assert.deepEqual(f.children[1].kills, ['SIGTERM']);
});
test('unrequested restart exit code uses crash backoff and does not silently restart immediately', () => {
  const f = fixture(); f.children[0].emit('exit', 75); assert.equal(f.children.length, 1); assert.equal(f.scheduled.length, 1); f.supervisor.stop();
});
test('two stale-lock recovery contenders cannot both own the same state', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babytracker-lock-race-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const departed = spawn(process.execPath, ['-e', 'process.exit(0)']); const oldPid = departed.pid;
  await new Promise((resolve, reject) => { departed.on('exit', resolve); departed.on('error', reject); });
  fs.writeFileSync(path.join(dir, 'controller.lock'), JSON.stringify({ pid: oldPid, nonce: 'old' }));
  const script = `const {acquireLock}=require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});try{const release=acquireLock(process.argv[1]);process.stdout.write('OWNED');setTimeout(()=>{release();process.exit(0)},700)}catch(e){process.stdout.write('BLOCKED');process.exit(2)}`;
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['-e', script, dir], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', d => { output += d; }); child.on('error', reject); child.on('exit', code => resolve({ code, output })); });
  const results = await Promise.all([run(), run()]); assert.equal(results.filter(r => r.output === 'OWNED').length, 1); assert.equal(results.filter(r => r.output === 'BLOCKED').length, 1);
});
