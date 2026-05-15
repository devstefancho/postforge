const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  generateDescription,
  buildPrompt,
  truncateAtSentence,
  MODEL,
  MAX_LEN,
} = require('./description-generator');

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
    setImmediate(() => {
      const err = new Error('spawn claude ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  };
}

test('returns trimmed first non-empty line from claude stdout', async () => {
  const child = makeFakeChild();
  const p = generateDescription({
    title: '리액트 훅 정리',
    body: '리액트 훅의 핵심 개념과 사용 패턴을 정리한 글입니다.',
    spawnFn: spawnReturning(child),
  });
  setImmediate(() => {
    child.stdout.emit('data', '  리액트 훅의 핵심 개념과 자주 쓰이는 패턴을 정리한 글입니다.\n');
    child.emit('close', 0);
  });
  const desc = await p;
  assert.equal(desc, '리액트 훅의 핵심 개념과 자주 쓰이는 패턴을 정리한 글입니다.');
});

test('skips leading prose and takes first content line', async () => {
  const child = makeFakeChild();
  const p = generateDescription({
    title: 't',
    body: 'b',
    spawnFn: spawnReturning(child),
  });
  setImmediate(() => {
    child.stdout.emit('data', '\n\n첫 번째 의미 있는 줄이 description.\n\n추가 안내 텍스트.\n');
    child.emit('close', 0);
  });
  assert.equal(await p, '첫 번째 의미 있는 줄이 description.');
});

test('truncates output longer than MAX_LEN at a sentence boundary', async () => {
  const sentence = '리액트 훅은 함수형 컴포넌트에서 상태와 라이프사이클을 다루기 위해 도입된 API다.';
  const longText = (sentence + ' ').repeat(10).trim();
  const child = makeFakeChild();
  const p = generateDescription({ title: 't', body: 'b', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', longText + '\n');
    child.emit('close', 0);
  });
  const desc = await p;
  assert.ok(desc.length <= MAX_LEN, `expected <= ${MAX_LEN}, got ${desc.length}`);
  assert.ok(/다\.$|요\.$|[.?!]$/.test(desc), `expected sentence end, got: ${desc}`);
});

test('rejects when claude CLI is missing (ENOENT)', async () => {
  const p = generateDescription({ title: 't', body: 'b', spawnFn: spawnThrowingENOENT() });
  await assert.rejects(p, /claude CLI not found/);
});

test('rejects on timeout and kills the child', async () => {
  const child = makeFakeChild();
  const p = generateDescription({
    title: 't', body: 'b', spawnFn: spawnReturning(child), timeoutMs: 20,
  });
  await assert.rejects(p, /timed out after 20ms/);
  assert.equal(child.killed, true);
});

test('rejects empty/whitespace title or body without spawning', async () => {
  let spawned = false;
  const spawnFn = () => { spawned = true; return makeFakeChild(); };
  await assert.rejects(
    generateDescription({ title: '  ', body: 'b', spawnFn }),
    /title is required/
  );
  await assert.rejects(
    generateDescription({ title: 't', body: '   ', spawnFn }),
    /body is required/
  );
  assert.equal(spawned, false);
});

test('rejects when claude exits non-zero, including stderr', async () => {
  const child = makeFakeChild();
  const p = generateDescription({ title: 't', body: 'b', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stderr.emit('data', 'not logged in');
    child.emit('close', 1);
  });
  await assert.rejects(p, /exited with code 1.*not logged in/);
});

test('rejects when claude returns empty stdout', async () => {
  const child = makeFakeChild();
  const p = generateDescription({ title: 't', body: 'b', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', '\n\n   \n');
    child.emit('close', 0);
  });
  await assert.rejects(p, /empty description/);
});

test('invokes claude CLI with -p, --model and a prompt carrying title and body', async () => {
  const child = makeFakeChild();
  let receivedCmd, receivedArgs;
  const spawnFn = (cmd, args) => { receivedCmd = cmd; receivedArgs = args; return child; };
  const p = generateDescription({ title: 'React Hooks', body: 'Hook intro text.', spawnFn });
  setImmediate(() => { child.stdout.emit('data', 'a description.\n'); child.emit('close', 0); });
  await p;
  assert.equal(receivedCmd, 'claude');
  assert.equal(receivedArgs[0], '-p');
  assert.equal(receivedArgs[1], '--model');
  assert.equal(receivedArgs[2], MODEL);
  assert.match(receivedArgs[3], /Title: React Hooks/);
  assert.match(receivedArgs[3], /Hook intro text/);
});

test('buildPrompt embeds title and body and asks for Korean summary', () => {
  const prompt = buildPrompt('리액트 훅', 'Body text.');
  assert.match(prompt, /Title: 리액트 훅/);
  assert.match(prompt, /Body text\./);
  assert.match(prompt, /Korean summary/i);
  assert.match(prompt, /Output ONLY/);
});

test('truncateAtSentence is a no-op for short text', () => {
  assert.equal(truncateAtSentence('짧은 문장이다.'), '짧은 문장이다.');
});
