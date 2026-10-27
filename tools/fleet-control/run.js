'use strict';
const { fork } = require('node:child_process');
const path = require('node:path');
function createSupervisor({ forkChild = fork, schedule = setTimeout, cancel = clearTimeout, now = Date.now, log = console.error } = {}) {
  let child, stopping = false, failures = [], restartTimer = null, started = false;
  function launch() {
    if (stopping) return;
    let requested = false;
    child = forkChild(path.join(__dirname, 'server.js'), [], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', msg => { if (msg?.type === 'babytracker-restart') requested = true; });
    child.on('exit', code => {
      if (stopping || code === 0) return;
      if (code === 75 && requested) return launch();
      failures = failures.filter(t => now() - t < 60000); failures.push(now());
      if (failures.length >= 3) { log('Controller stopped after three startup failures; inspect the log.'); process.exitCode = 1; return; }
      restartTimer = schedule(launch, 2000);
    });
  }
  return {
    start() { if (started) throw Error('Supervisor has already started'); started = true; launch(); },
    stop() { stopping = true; if (restartTimer) cancel(restartTimer); child?.kill('SIGTERM'); }
  };
}

if (require.main === module) {
  const supervisor = createSupervisor();
  process.on('SIGINT', () => supervisor.stop()); process.on('SIGTERM', () => supervisor.stop());
  supervisor.start();
}
module.exports = { createSupervisor };
