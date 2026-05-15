const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateSlug, buildPrompt, SLUG_PATTERN, MODEL } = require('./slug-generator');

// Minimal fake of a ChildProcess: emits stdout/stderr/close/error as orchestrated by the test.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  child.killed = false;
  return child;
}

function spawnReturning(child) {
  return () => child;
}

function spawnThrowingENOENT() {
  return () => {
    const child = makeFakeChild();
    // emit error asynchronously to mimic real spawn behavior on missing binary
    setImmediate(() => {
      const err = new Error('spawn claude ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  };
}

test('returns trimmed slug when claude -p outputs a valid slug', async () => {
  const child = makeFakeChild();
  const p = generateSlug({ title: '리액트 훅 정리', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', '  react-hooks-summary\n');
    child.emit('close', 0);
  });
  const slug = await p;
  assert.equal(slug, 'react-hooks-summary');
  assert.ok(SLUG_PATTERN.test(slug));
});

test('takes first non-empty line when claude appends prose (e.g. voice-briefing)', async () => {
  const child = makeFakeChild();
  const p = generateSlug({ title: '리액트 훅 정리', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', 'react-hooks-guide\n\n음성 브리핑: 슬러그를 출력했습니다.\n');
    child.emit('close', 0);
  });
  assert.equal(await p, 'react-hooks-guide');
});

test('rejects when stdout violates slug format (uppercase, spaces, prose)', async () => {
  const child = makeFakeChild();
  const p = generateSlug({ title: 'My Post', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', "Here's a slug: React-Hooks Summary");
    child.emit('close', 0);
  });
  await assert.rejects(p, /invalid slug format/);
});

test('rejects with helpful message when claude CLI is missing (ENOENT)', async () => {
  const p = generateSlug({ title: 'anything', spawnFn: spawnThrowingENOENT() });
  await assert.rejects(p, /claude CLI not found/);
});

test('rejects on timeout and kills the child', async () => {
  const child = makeFakeChild();
  const p = generateSlug({ title: 'slow title', spawnFn: spawnReturning(child), timeoutMs: 20 });
  // Never emit close — let the timer fire.
  await assert.rejects(p, /timed out after 20ms/);
  assert.equal(child.killed, true);
});

test('rejects empty / whitespace title without spawning', async () => {
  let spawned = false;
  const spawnFn = () => { spawned = true; return makeFakeChild(); };
  await assert.rejects(generateSlug({ title: '   ', spawnFn }), /title is required/);
  assert.equal(spawned, false);
});

test('rejects when claude exits non-zero, including stderr in message', async () => {
  const child = makeFakeChild();
  const p = generateSlug({ title: 'x', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stderr.emit('data', 'not logged in');
    child.emit('close', 1);
  });
  await assert.rejects(p, /exited with code 1.*not logged in/);
});

test('invokes claude CLI with -p, --model and the prompt', async () => {
  const child = makeFakeChild();
  let receivedCmd, receivedArgs;
  const spawnFn = (cmd, args) => { receivedCmd = cmd; receivedArgs = args; return child; };
  const p = generateSlug({ title: 'test', spawnFn });
  setImmediate(() => { child.stdout.emit('data', 'ok-slug\n'); child.emit('close', 0); });
  await p;
  assert.equal(receivedCmd, 'claude');
  assert.equal(receivedArgs[0], '-p');
  assert.equal(receivedArgs[1], '--model');
  assert.equal(receivedArgs[2], MODEL);
  assert.match(receivedArgs[3], /Title: test/);
});

test('buildPrompt includes the title and the output constraints', () => {
  const prompt = buildPrompt('리액트 훅');
  assert.match(prompt, /리액트 훅/);
  assert.match(prompt, /kebab-case/);
  assert.match(prompt, /Output ONLY/);
});
