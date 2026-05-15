const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { translateTopic, buildPrompt, MODEL } = require('./hero-topic-translator');

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  child.killed = false;
  return child;
}

function spawnReturning(child) { return () => child; }

function spawnThrowingENOENT() {
  return () => {
    const child = makeFakeChild();
    setImmediate(() => {
      const err = new Error('spawn claude ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  };
}

test('returns trimmed first non-empty line as English topic phrase', async () => {
  const child = makeFakeChild();
  const p = translateTopic({
    title: '리액트 훅 정리',
    description: '핵심 정리.',
    tags: ['react', 'hooks'],
    spawnFn: spawnReturning(child),
  });
  setImmediate(() => {
    child.stdout.emit('data', '  react hooks summary guide\n');
    child.emit('close', 0);
  });
  assert.equal(await p, 'react hooks summary guide');
});

test('takes first non-empty line, ignores trailing prose', async () => {
  const child = makeFakeChild();
  const p = translateTopic({ title: 't', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', '\nminimalist abstract concept\n\n(voice briefing trailing text)\n');
    child.emit('close', 0);
  });
  assert.equal(await p, 'minimalist abstract concept');
});

test('rejects when claude CLI is missing (ENOENT)', async () => {
  await assert.rejects(
    translateTopic({ title: 't', spawnFn: spawnThrowingENOENT() }),
    /claude CLI not found/
  );
});

test('rejects on timeout and kills the child', async () => {
  const child = makeFakeChild();
  const p = translateTopic({ title: 't', spawnFn: spawnReturning(child), timeoutMs: 20 });
  await assert.rejects(p, /timed out after 20ms/);
  assert.equal(child.killed, true);
});

test('rejects when title is empty without spawning', async () => {
  let spawned = false;
  const spawnFn = () => { spawned = true; return makeFakeChild(); };
  await assert.rejects(translateTopic({ title: '  ', spawnFn }), /title is required/);
  assert.equal(spawned, false);
});

test('rejects when claude exits non-zero, including stderr', async () => {
  const child = makeFakeChild();
  const p = translateTopic({ title: 't', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stderr.emit('data', 'not logged in');
    child.emit('close', 1);
  });
  await assert.rejects(p, /exited with code 1.*not logged in/);
});

test('rejects when claude returns empty stdout', async () => {
  const child = makeFakeChild();
  const p = translateTopic({ title: 't', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', '\n   \n');
    child.emit('close', 0);
  });
  await assert.rejects(p, /empty topic phrase/);
});

test('invokes claude CLI with haiku model and prompt carrying inputs', async () => {
  const child = makeFakeChild();
  let receivedCmd, receivedArgs;
  const spawnFn = (cmd, args) => { receivedCmd = cmd; receivedArgs = args; return child; };
  const p = translateTopic({
    title: '리액트 훅', description: '요약', tags: ['x'], category: 'blog', spawnFn,
  });
  setImmediate(() => { child.stdout.emit('data', 'phrase\n'); child.emit('close', 0); });
  await p;
  assert.equal(receivedCmd, 'claude');
  assert.equal(receivedArgs[0], '-p');
  assert.equal(receivedArgs[1], '--model');
  assert.equal(receivedArgs[2], MODEL);
  assert.match(receivedArgs[3], /Title: 리액트 훅/);
  assert.match(receivedArgs[3], /Description: 요약/);
  assert.match(receivedArgs[3], /Tags: x/);
  assert.match(receivedArgs[3], /Category: blog/);
});

test('buildPrompt asks for English noun phrase without Korean characters', () => {
  const p = buildPrompt({ title: 't' });
  assert.match(p, /ONE short English noun phrase/);
  assert.match(p, /no Korean characters/);
  assert.match(p, /Output ONLY/);
});
