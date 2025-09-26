const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

function loadJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

function main() {
  const root = process.cwd();
  const controlDir = join(root, '.control');
  const state = loadJson(join(controlDir, 'state.json'));
  if (!state) {
    console.error('No .control/state.json found.');
    process.exitCode = 1;
    return;
  }

  console.log('Current cursor');
  console.log('  sprint: ' + state.current_sprint);
  console.log('  task:   ' + state.current_task);
  console.log('  last_successful_commit: ' + state.last_successful_commit);
  console.log('  last_release: ' + (state.last_release ?? 'n/a'));

  const checkpointsDir = join(controlDir, 'checkpoints');
  const failed = [];
  if (existsSync(checkpointsDir)) {
    const files = readdirSync(checkpointsDir).filter(file => file.endsWith('.json'));
    for (const file of files) {
      const data = loadJson(join(checkpointsDir, file));
      if (data && data.status === 'failed') {
        failed.push(data.task + ' (' + file + ')');
      }
    }
  }

  console.log('Failed tasks');
  if (failed.length === 0) {
    console.log('  none');
  } else {
    for (const item of failed) {
      console.log('  - ' + item);
    }
  }

  const lockPath = join(controlDir, 'lock');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const acquired = new Date(lock.acquired_at).getTime();
      const ttl = Number(lock.ttl_ms ?? 0);
      const now = Date.now();
      const age = now - acquired;
      const stale = ttl > 0 ? age > ttl : false;
      console.log('Lock');
      console.log('  owner: ' + (lock.owner ?? 'unknown'));
      console.log('  acquired_at: ' + lock.acquired_at);
      console.log('  ttl_ms: ' + ttl);
      console.log('  status: ' + (stale ? 'STALE' : 'active'));
    } catch (err) {
      console.warn('Lock file unreadable:', err);
    }
  } else {
    console.log('Lock');
    console.log('  none');
  }

  const execLogPath = join(controlDir, 'exec_log.ndjson');
  if (existsSync(execLogPath)) {
    const lines = readFileSync(execLogPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
    const tail = lines.slice(-20);
    console.log('Last exec log entries');
    for (const line of tail) {
      console.log('  ' + line);
    }
  } else {
    console.log('Last exec log entries');
    console.log('  none');
  }
}

main();
