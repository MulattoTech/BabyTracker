// Real browser acceptance against disposable synthetic storage only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { createPrismaAdapter } = require('../prisma/prisma-adapter.js');

const scratch = mkdtempSync(path.join(tmpdir(), 'babytracker-browser-synthetic-'));
const databaseUrl = `file:${path.join(scratch, 'synthetic.db')}`;
const secret = randomBytes(32).toString('hex');
const env = { ...process.env, DATABASE_URL: databaseUrl, LOG_DATABASE_URL: `file:${path.join(scratch, 'synthetic-log.db')}`,
  JWT_SECRET: secret, ENC_HASH: randomBytes(32).toString('hex'), DEPLOYMENT_MODE: 'selfhosted',
  BABYTRACKER_OCR_FILES_DIR: path.join(scratch, 'sources'),
  ENABLE_NOTIFICATIONS: 'false', ENABLE_LOG: 'false', NEXT_TELEMETRY_DISABLED: '1', COOKIE_SECURE: 'false' };
const reportDir = path.join(process.cwd(), 'test-results');
mkdirSync(reportDir, { recursive: true });
let server, serverLifecycle, browser, browserServer, browserLifecycle, db, failure;
let output = '';
const documents = [];
const report = { syntheticOnly: true, startedAt: new Date().toISOString(), checks: [], screenshots: [] };

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its cleanup deadline`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function trackOwnedProcess(child) {
  // Subscribe immediately: an already-exited child will never emit exit again.
  let spawnError;
  const exit = new Promise(resolve => child.once('exit', resolve));
  const close = new Promise(resolve => child.once('close', resolve));
  child.once('error', error => { spawnError = error; });
  return { child, exit, close, get exited() { return child.exitCode !== null || child.signalCode !== null; }, get spawnError() { return spawnError; } };
}

async function stopOwnedProcess(lifecycle, label) {
  if (!lifecycle) return { exited: true, forced: false };
  const { child } = lifecycle;
  let forced = false;
  try {
    if (!lifecycle.exited && child.pid) {
      child.kill('SIGTERM');
      await bounded(lifecycle.exit, 3000, `${label} graceful shutdown`).catch(() => {});
      if (!lifecycle.exited) {
        forced = true;
        child.kill('SIGKILL');
        await bounded(lifecycle.exit, 5000, `${label} forced shutdown`);
      }
    }
    assert.ok(lifecycle.exited || lifecycle.spawnError, `${label} termination was not verified`);
    // Close only this owned child's pipes; no name-based or global termination.
    for (const stream of child.stdio || []) stream?.destroy?.();
    await bounded(lifecycle.close, 2000, `${label} pipe closure`);
    return { exited: true, forced };
  } finally {
    for (const stream of child.stdio || []) stream?.destroy?.();
    // An unkillable child must produce FAIL, but must not hold the reporter open.
    if (!lifecycle.exited && child.pid) child.unref();
  }
}

try {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'pipe', timeout: 60_000 });
  db = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  const family = await db.family.create({ data: { id: 'browser-family', slug: 'synthetic-ocr', name: 'Synthetic OCR family', setupStage: 3 } });
  const baby = await db.baby.create({ data: { id: 'browser-baby', familyId: family.id, firstName: 'Synthetic', lastName: 'Fixture', birthDate: new Date('2026-01-01Z') } });
  const caretaker = await db.caretaker.create({ data: { id: 'browser-caretaker', familyId: family.id, loginId: '01', name: 'Synthetic Reviewer', role: 'ADMIN', type: 'parent', securityPin: randomBytes(16).toString('hex'), lastSeenVersion: '1.6.7' } });
  await db.settings.create({ data: { familyId: family.id, familyName: family.name } });
  for (const unitAbbr of ['ML', 'OZ']) await db.unit.create({ data: { unitAbbr, unitName: unitAbbr } });
  const token = jwt.sign({ id: caretaker.id, name: caretaker.name, role: 'ADMIN', type: 'parent', familyId: family.id, familySlug: family.slug }, secret, { expiresIn: '10m' });
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverLifecycle = trackOwnedProcess(server);
  server.stdout.on('data', chunk => { output = (output + chunk).slice(-20000); });
  server.stderr.on('data', chunk => { output = (output + chunk).slice(-20000); });
  const readyDeadline = Date.now() + 30_000;
  for (;;) {
    if (serverLifecycle.spawnError || serverLifecycle.exited) throw new Error('Synthetic app exited before readiness.');
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1500) });
      await response.body?.cancel();
      if (response.status >= 500) throw new Error('Synthetic app is not ready.');
      break;
    } catch {
      if (Date.now() >= readyDeadline) throw new Error('Synthetic app did not start within 30 seconds.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const unauthenticated = await fetch(`${base}/api/ocr/documents?babyId=${baby.id}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(unauthenticated.status, 401); await unauthenticated.body?.cancel();
  report.checks.push('Unauthenticated document access rejected');
  browserServer = await chromium.launchServer({ headless: true, executablePath: process.env.BABYTRACKER_TEST_BROWSER_PATH || undefined, timeout: 30_000 });
  browserLifecycle = trackOwnedProcess(browserServer.process());
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 15_000 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(({ token, family, baby, caretakerId }) => {
    localStorage.setItem('authToken', token); localStorage.setItem('unlockTime', String(Date.now()));
    localStorage.setItem('caretakerId', caretakerId); localStorage.setItem('isAdmin', 'true');
    localStorage.setItem('selectedFamily', JSON.stringify(family));
    localStorage.setItem(`selectedBaby_${family.id}`, JSON.stringify(baby));
  }, { token, family, baby, caretakerId: caretaker.id });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/${family.slug}/ocr-import?babyId=${baby.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Document import', exact: true }).waitFor();
  await page.getByLabel('Photo or document', { exact: true }).waitFor();
  const image = await sharp(Buffer.from('<svg width="1700" height="700" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g font-family="DejaVu Sans" font-size="48"><text x="60" y="130">08:15 bottle formula 90 mL</text><text x="60" y="280">09:30 wet diaper</text></g></svg>')).png().toBuffer();
  await page.getByLabel('Photo or document', { exact: true }).setInputFiles({ name: 'synthetic-care-log.png', mimeType: 'image/png', buffer: image });
  await page.getByLabel('Date for rows without a date', { exact: true }).fill('2026-10-20');
  await page.getByLabel('Source time zone', { exact: true }).fill('America/Chicago');
  await page.getByLabel('Clock format on this sheet', { exact: true }).selectOption('24h');
  await page.getByRole('button', { name: 'Upload and create review draft', exact: true }).click();
  await page.getByRole('heading', { name: 'Review draft', exact: true }).waitFor({ timeout: 45_000 });
  const draft = await db.ocrDocument.findFirstOrThrow(); documents.push(draft.id);
  assert.equal(await db.feedLog.count(), 0);
  assert.equal(await db.diaperLog.count(), 0);
  report.checks.push('Image upload creates only encrypted review draft');
  await page.getByLabel('Feeding amount', { exact: true }).fill('95');
  await page.getByRole('button', { name: 'Approve all valid rows I reviewed', exact: true }).click();
  await page.getByRole('button', { name: 'Save review draft', exact: true }).click();
  await page.getByText('Draft saved. No care events were imported.', { exact: true }).waitFor();
  assert.equal(await db.feedLog.count(), 0);
  await page.getByRole('button', { name: 'Check selected events and duplicates', exact: true }).click();
  await page.getByRole('heading', { name: 'Import preview — no care events saved', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm and import approved events', exact: true }).isDisabled(), true);
  const desktop = path.join(reportDir, 'ocr-desktop.png');
  await page.screenshot({ path: desktop, fullPage: true }); report.screenshots.push(desktop);
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${name} layout overflows`);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
    const screenshot = path.join(reportDir, `ocr-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }); report.screenshots.push(screenshot);
    report.checks.push(`${name} viewport fits and keyboard focus is reachable`);
  }
  await page.getByLabel('I reviewed the original source, every selected event, all corrections and warnings, and any duplicate decisions. Import these approved events.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirm and import approved events', exact: true }).click();
  await page.getByRole('heading', { name: 'Import saved to the care timeline', exact: true }).waitFor();
  const feed = await db.feedLog.findFirstOrThrow();
  assert.equal(feed.amount, 95); assert.equal(feed.unitAbbr, 'ML'); assert.equal(feed.time.toISOString(), '2026-10-20T13:15:00.000Z');
  assert.equal(await db.diaperLog.count(), 1);
  const timeline = await fetch(`${base}/api/timeline?babyId=${baby.id}&startDate=2026-10-20T00:00:00Z&endDate=2026-10-21T00:00:00Z`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(timeline.status, 200);
  assert.match(await timeline.text(), /95/);
  report.checks.push('Corrected approved feed/diaper values appear in ordinary Sprout timeline');
  const userToken = jwt.sign({ id: caretaker.id, name: caretaker.name, role: 'USER', familyId: family.id, familySlug: family.slug }, secret, { expiresIn: '5m' });
  const denied = await fetch(`${base}/api/ocr/documents?babyId=${baby.id}`, { headers: { Authorization: `Bearer ${userToken}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(denied.status, 403); await denied.body?.cancel();
  report.checks.push('Non-admin import access rejected');
  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  report.browserChecksPassed = true;
} catch (error) {
  failure = error; report.error = error.message;
} finally {
  const cleanupErrors = [];
  report.cleanup = {};
  try {
    if (browser) await bounded(browser.close(), 5000, 'Browser connection closure');
  } catch (error) { report.cleanup.browserGracefulCloseTimedOut = true; }
  try {
    if (browserServer) {
      try {
        try { await bounded(browserServer.close(), 5000, 'Owned browser shutdown'); }
        catch { await bounded(browserServer.kill(), 5000, 'Owned browser forced shutdown'); }
      } finally {
        report.cleanup.browser = await stopOwnedProcess(browserLifecycle, 'Synthetic browser');
      }
    }
  } catch (error) { cleanupErrors.push(error.message); }
  try { report.cleanup.server = await stopOwnedProcess(serverLifecycle, 'Synthetic Next server'); }
  catch (error) { cleanupErrors.push(error.message); }
  try {
    // Clean encrypted synthetic sources by exact names from this disposable database.
    if (db) {
      for (const id of documents) {
        const doc = await bounded(db.ocrDocument.findUnique({ where: { id } }), 5000, 'Synthetic source lookup');
        for (const file of [doc?.sourceFile, ...JSON.parse(doc?.previewFiles || '[]').map(page => page.file)].filter(Boolean)) {
          if (/^[a-f\d-]{36}\.enc$/i.test(file)) rmSync(path.join(env.BABYTRACKER_OCR_FILES_DIR, file), { force: true });
        }
      }
    }
  } catch (error) { cleanupErrors.push(error.message); }
  try { if (db) await bounded(db.$disconnect(), 5000, 'Synthetic database disconnect'); }
  catch (error) { cleanupErrors.push(error.message); }
  try { if (!serverLifecycle || serverLifecycle.exited || serverLifecycle.spawnError) rmSync(scratch, { recursive: true, force: true }); }
  catch (error) { cleanupErrors.push(error.message); }
  report.cleanup.errors = cleanupErrors;
  report.status = failure || cleanupErrors.length ? 'FAIL' : 'PASS';
  report.completedAt = new Date().toISOString();
  if (report.status === 'FAIL') {
    // Only the synthetic test server writes this log; never attach production logs.
    writeFileSync(path.join(reportDir, 'ocr-browser-server.log'), output);
    process.exitCode = 1;
  }
  writeFileSync(path.join(reportDir, 'ocr-browser-report.json'), JSON.stringify(report, null, 2));
  // PASS is emitted only after owned processes exited and cleanup completed.
  console.log(JSON.stringify({ status: report.status, checks: report.checks, screenshots: report.screenshots, cleanup: report.cleanup, error: report.error }, null, 2));
}
