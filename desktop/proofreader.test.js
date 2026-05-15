const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { protect, restore, proofread, MODEL } = require('./proofreader');

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (sig) => { child.killed = true; child.killSignal = sig; };
  child.killed = false;
  return child;
}

function spawnReturning(child) {
  return () => child;
}

// ─── protect / restore ─────────────────────────────────────────────────────

test('protect+restore round-trip preserves prose with fenced code, inline, and URL', () => {
  const body = [
    '# 제목',
    '',
    '여기에 `code` 가 있어요.',
    '',
    '```js',
    'const x = 1; // 이건 코드라 안 바뀌어야 함',
    '```',
    '',
    '자세한 내용은 [공식 문서](https://example.com/ko/docs) 를 보세요.',
    '',
    '이미지: ![설명](./img/hero.png)',
  ].join('\n');

  const { protectedText, placeholders } = protect(body);

  // Protected segments must be gone from the protected text.
  assert.ok(!protectedText.includes('const x = 1'));
  assert.ok(!protectedText.includes('https://example.com/ko/docs'));
  assert.ok(!protectedText.includes('./img/hero.png'));
  // Bracket text remains visible to the LLM.
  assert.match(protectedText, /\[공식 문서\]/);
  assert.match(protectedText, /\[설명\]/);

  // Identity round-trip with no LLM modifications.
  assert.equal(restore(protectedText, placeholders), body);
});

test('protect leaves prose without protected segments untouched', () => {
  const body = '평범한 한국어 문장입니다. 띄어쓰기와 조사가 어색할 수 있어요.';
  const { protectedText, placeholders } = protect(body);
  assert.equal(placeholders.length, 0);
  assert.equal(protectedText, body);
});

test('restore returns null if any placeholder was dropped', () => {
  const body = 'before `code` after';
  const { protectedText, placeholders } = protect(body);
  // Simulate the LLM deleting the placeholder
  const mangled = protectedText.replace(/‹‹PFG0››/, '');
  assert.equal(restore(mangled, placeholders), null);
});

test('restore returns null if a placeholder was duplicated', () => {
  const body = '읽어주세요 `a()` 부탁드립니다';
  const { protectedText, placeholders } = protect(body);
  const mangled = protectedText + ' ‹‹PFG0››';
  assert.equal(restore(mangled, placeholders), null);
});

test('restore returns null if the LLM invents an extra placeholder', () => {
  const body = 'no protected segments';
  const { protectedText, placeholders } = protect(body);
  assert.equal(placeholders.length, 0);
  const mangled = protectedText + ' ‹‹PFG0››';
  assert.equal(restore(mangled, placeholders), null);
});

// ─── proofread orchestration ───────────────────────────────────────────────

test('proofread resolves with restored body on valid response', async () => {
  const child = makeFakeChild();
  let receivedCmd, receivedArgs;
  const spawnFn = (cmd, args) => { receivedCmd = cmd; receivedArgs = args; return child; };
  const body = '안년하세요. 오늘은 `react` 훅을 공부합니다.';
  const p = proofread({ body, spawnFn });
  // The LLM produces a corrected version that preserves the placeholder for `react`.
  setImmediate(() => {
    child.stdout.emit('data', '안녕하세요. 오늘은 ‹‹PFG0›› 훅을 공부합니다.\n');
    child.emit('close', 0);
  });
  const result = await p;
  assert.equal(result, '안녕하세요. 오늘은 `react` 훅을 공부합니다.');
  assert.equal(receivedCmd, 'claude');
  assert.deepEqual(receivedArgs.slice(0, 3), ['-p', '--model', MODEL]);
});

test('proofread rejects when LLM corrupts a protected segment', async () => {
  const child = makeFakeChild();
  const body = '`code`만 있어요';
  const p = proofread({ body, spawnFn: spawnReturning(child) });
  // LLM drops the placeholder entirely
  setImmediate(() => {
    child.stdout.emit('data', '만 있어요\n');
    child.emit('close', 0);
  });
  await assert.rejects(p, /protected segments were corrupted/);
});

test('proofread rejects on timeout and kills child', async () => {
  const child = makeFakeChild();
  const p = proofread({ body: '느린 응답', spawnFn: spawnReturning(child), timeoutMs: 25 });
  await assert.rejects(p, /timed out after 25ms/);
  assert.equal(child.killed, true);
  assert.equal(child.killSignal, 'SIGTERM');
});

test('proofread aborts when AbortSignal fires mid-flight', async () => {
  const child = makeFakeChild();
  const ctrl = new AbortController();
  const p = proofread({ body: '취소될 호출', spawnFn: spawnReturning(child), signal: ctrl.signal });
  setImmediate(() => ctrl.abort());
  await assert.rejects(p, /cancelled/);
  assert.equal(child.killed, true);
});

test('proofread rejects immediately when signal is already aborted', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let spawned = false;
  const spawnFn = () => { spawned = true; return makeFakeChild(); };
  await assert.rejects(
    proofread({ body: '뭐든', spawnFn, signal: ctrl.signal }),
    /cancelled/
  );
  assert.equal(spawned, false);
});

test('proofread rejects with helpful message when claude CLI is missing (ENOENT)', async () => {
  const spawnFn = () => {
    const child = makeFakeChild();
    setImmediate(() => {
      const err = new Error('spawn claude ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  };
  await assert.rejects(proofread({ body: '뭐든', spawnFn }), /claude CLI not found/);
});

test('proofread refuses empty body without spawning', async () => {
  let spawned = false;
  const spawnFn = () => { spawned = true; return makeFakeChild(); };
  await assert.rejects(proofread({ body: '   \n  ', spawnFn }), /body is required/);
  assert.equal(spawned, false);
});

test('proofread rejects when claude exits non-zero, including stderr', async () => {
  const child = makeFakeChild();
  const p = proofread({ body: '본문', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stderr.emit('data', 'rate limit exceeded');
    child.emit('close', 1);
  });
  await assert.rejects(p, /exited with code 1.*rate limit/);
});

test('proofread rejects on empty response', async () => {
  const child = makeFakeChild();
  const p = proofread({ body: '본문', spawnFn: spawnReturning(child) });
  setImmediate(() => {
    child.stdout.emit('data', '   \n\n');
    child.emit('close', 0);
  });
  await assert.rejects(p, /empty response/);
});
