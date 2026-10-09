import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processRssBytes,
  withinMemoryDeadline,
  sampleProcessRss,
  exportMemorySamples,
} from '../scripts/process-memory.mjs';

void test('RSS sums every requested process independent of ps ordering', () => {
  assert.equal(processRssBytes([401, 402], ' 402 80\n 401 120\n'), 204800);
});

void test('an incomplete process snapshot cannot masquerade as lower memory use', () => {
  for (const text of [
    '401 120',
    '401 120\n401 80',
    '401 120\n403 80',
    '401 120\n402 80\n403 1',
    '',
  ])
    assert.throws(() => processRssBytes([401, 402], text));
});

void test('RSS rejects invalid counters and process identifiers', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740991'])
    assert.throws(() => processRssBytes([401], `401 ${value}`));
  for (const ids of [[], [401, 401], [0], [-1], [1.5], [NaN]])
    assert.throws(() => processRssBytes(ids, '401 10'));
  assert.throws(() => processRssBytes([401], '401 10 extra'));
});

void test(
  'a hung memory sample fails within a deadline so browser cleanup can run',
  { timeout: 2000 },
  async () => {
    await assert.rejects(
      withinMemoryDeadline(() => new Promise<number>(() => {}), 20),
      /timed out/,
    );
    assert.equal(await withinMemoryDeadline(async () => 204800, 100), 204800);
    await assert.rejects(
      withinMemoryDeadline(async () => {
        throw new Error('CDP failed');
      }, 100),
      /CDP failed/,
    );
  },
);

void test('only an OS and CDP proven dead auxiliary PID permits one fresh complete RSS sample', async () => {
  const lists = [
    [
      { id: 401, type: 'browser' },
      { id: 402, type: 'renderer' },
      { id: 403, type: 'notifications' },
    ],
    [
      { id: 401, type: 'browser' },
      { id: 402, type: 'renderer' },
    ],
  ];
  const attempts: { status: string }[] = [];
  let calls = 0;
  const result = await sampleProcessRss({
    listProcesses: async () => lists[calls++],
    readRss: async () => '401 120\n402 80\n',
    isAlive: (id: number) => {
      assert.equal(id, 403);
      return false;
    },
    onAttempt: (attempt: { status: string }) => {
      attempts.push(attempt);
    },
  });
  assert.equal(result.rssBytes, 204800);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, 'failed');
  assert.equal(result.attempts[1].status, 'complete');
  assert.ok(attempts.some((a) => a.status === 'failed'));
});

void test('missing live, renderer, worker, GPU or repeatedly missing processes still fail RSS measurement', async () => {
  for (const type of ['renderer', 'worker', 'GPU', 'notifications']) {
    let lists = 0;
    await assert.rejects(
      sampleProcessRss({
        listProcesses: async () => {
          lists++;
          return [
            { id: 401, type: 'browser' },
            { id: 402, type },
          ];
        },
        readRss: async () => '401 120\n',
        isAlive: () => true,
      }),
      /Missing Chromium/,
    );
    assert.equal(lists, type === 'notifications' ? 2 : 1);
  }
  let calls = 0;
  await assert.rejects(
    sampleProcessRss({
      listProcesses: async () =>
        ++calls === 1
          ? [
              { id: 401, type: 'browser' },
              { id: 402, type: 'notifications' },
            ]
          : [
              { id: 401, type: 'browser' },
              { id: 403, type: 'notifications' },
            ],
      readRss: async () => '401 120\n',
      isAlive: () => false,
    }),
    /Missing Chromium/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    sampleProcessRss({
      listProcesses: async () => [{ id: 401, type: 'browser' }],
      readRss: async () => {
        throw Error('ps unavailable');
      },
      isAlive: () => false,
    }),
    /ps unavailable/,
  );
  await assert.rejects(
    sampleProcessRss({
      listProcesses: async () => new Promise(() => {}),
      readRss: async () => '',
      isAlive: () => false,
      timeoutMs: 20,
    }),
    /timed out/,
  );
});

void test('export memory coverage requires full containment in a real successful Worker interval', () => {
  const action = {
    action: 'export',
    ok: true,
    startedEpochMs: 100,
    endedEpochMs: 200,
  };
  const sample = { hostSampleStartedEpochMs: 120, hostSampleEndedEpochMs: 180 };
  assert.equal(exportMemorySamples([sample], [action]).length, 1);
  for (const invalid of [
    { ...sample, hostSampleStartedEpochMs: 90 },
    { ...sample, hostSampleEndedEpochMs: 210 },
    { ...sample, hostSampleEndedEpochMs: 110 },
    { ...sample, hostSampleStartedEpochMs: NaN },
  ])
    assert.equal(exportMemorySamples([invalid], [action]).length, 0);
  assert.equal(
    exportMemorySamples([sample], [{ ...action, ok: false }]).length,
    0,
  );
  assert.equal(
    exportMemorySamples([sample], [{ ...action, action: 'reconcile' }]).length,
    0,
  );
  assert.equal(exportMemorySamples([sample], []).length, 0);
});

void test('a timed-out sample cannot append late trace evidence after the verdict', async () => {
  const trace: unknown[] = [];
  let finish!: (value: string) => void;
  await assert.rejects(
    sampleProcessRss({
      listProcesses: async () => [{ id: 401, type: 'browser' }],
      readRss: async () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      isAlive: () => true,
      onAttempt: (attempt) => {
        trace.push(attempt);
      },
      timeoutMs: 20,
    }),
    /timed out/,
  );
  assert.equal(trace.length, 1);
  finish('401 120\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(trace.length, 1);
});

void test('zero RSS stays invalid; only a proved exited auxiliary PID earns one new complete sample', async () => {
  assert.throws(
    () => processRssBytes([401, 402], '401 120\n402 0\n'),
    /Zero Chromium/,
  );
  const trace: { status: string; zeroRssIds?: number[] }[] = [];
  let listed = 0,
    read = 0;
  const measured = await sampleProcessRss({
    listProcesses: async () =>
      ++listed === 1
        ? [
            { id: 401, type: 'browser' },
            { id: 402, type: 'unzip.mojom.Unzipper' },
          ]
        : [{ id: 401, type: 'browser' }],
    readRss: async () => (++read === 1 ? '401 120\n402 0\n' : '401 160\n'),
    isAlive: () => false,
    onAttempt: (attempt) => {
      trace.push(attempt);
    },
  });
  assert.equal(measured.rssBytes, 160 * 1024);
  assert.equal(measured.attempts.length, 2);
  assert.deepEqual(measured.attempts[0].zeroRssIds, [402]);
  assert.equal(measured.attempts[0].qualification.permitsRetry, true);
  assert.deepEqual(measured.attempts[0].qualification.osChecks, [
    { id: 402, alive: false },
  ]);
  assert.ok(
    trace.some(
      (attempt) =>
      attempt.status === 'failed' && attempt.zeroRssIds?.includes(402),
    ),
  );
  for (const type of [
    'browser',
    'renderer',
    'worker',
    'GPU',
    'unzip.mojom.Unzipper',
  ]) {
    let reads = 0;
    await assert.rejects(
      sampleProcessRss({
        listProcesses: async () => [
          { id: 401, type: 'browser' },
          { id: 402, type },
        ],
        readRss: async () => {
          reads++;
          return '401 120\n402 0\n';
        },
        isAlive: () => true,
      }),
      /Zero Chromium/,
    );
    assert.equal(reads, 1);
  }
  for (const alive of [true, undefined, 0])
    await assert.rejects(
      sampleProcessRss({
        listProcesses: async () =>
          ++listed % 2
            ? [
                { id: 401, type: 'browser' },
                { id: 402, type: 'unzip.mojom.Unzipper' },
              ]
            : [{ id: 401, type: 'browser' }],
        readRss: async () => '401 120\n402 0\n',
        isAlive: () => alive,
      }),
      /Zero Chromium/,
    );
  let calls = 0;
  await assert.rejects(
    sampleProcessRss({
      listProcesses: async () =>
        ++calls === 1
          ? [
              { id: 401, type: 'browser' },
              { id: 402, type: 'unzip.mojom.Unzipper' },
            ]
          : [
              { id: 401, type: 'browser' },
              { id: 403, type: 'unzip.mojom.Unzipper' },
            ],
      readRss: async (ids: number[]) =>
        ids.map((id) => `${id} ${id === 401 ? 120 : 0}`).join('\n'),
      isAlive: () => false,
    }),
    /Zero Chromium/,
  );
  assert.equal(calls, 2);
});
