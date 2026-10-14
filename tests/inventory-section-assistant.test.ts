import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readStockFile,
  replayStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  STOCK_ROLES,
  STOCK_VERSION,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import { askVerifiedSpecializedEvidence } from '../lib/reconciliation/domain-assistant.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
void test('Section assistant distinguishes supplied money from supported GL value in Arabic and English without promoting missing evidence', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'inv-section-assistant-'),
  );
  try {
    const sources = path.join(directory, 'sources');
    execFileSync(
      process.env.PYTHON ?? 'python3',
      [
        '-B',
        'audit/inventory-section-components/generate.py',
        '--output-dir',
        sources,
      ],
      { timeout: 30000 },
    );
    const source = path.join(sources, 'cases', 'INV1B-N05');
    const files = await Promise.all(
      ['register.xlsx', 'source-1.csv', 'source-2.csv', 'source-3.csv'].map(
        async (name) => {
          const bytes = new Uint8Array(await readFile(path.join(source, name)));
          return readStockFile(name, bytes.buffer);
        },
      ),
    );
    const suppliedScope = new Map(
      files[0].sheets[0].rows
        .filter((row) => row[0] === 'Scope')
        .map((row) => [row[1], row[2]]),
    );
    const input: StockInput = {
      files: files as StockInput['files'],
      scope: {
        ...Object.fromEntries(
          STOCK_FIELDS.map((key, i) => [
            key,
            suppliedScope.get(STOCK_SCOPE_HEADERS[i]),
          ]),
        ),
        confirmed: true,
      } as StockInput['scope'],
      readings: STOCK_ROLES.map((role, i) => ({
        role,
        sheet: 0,
        confirmed: true,
        family: i === 0 ? 'inventory-section-components-1' : STOCK_VERSION,
      })) as StockInput['readings'],
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    };
    const fresh = await replayStock(input);
    assert.equal(fresh.result.financial, 'missing');
    assert.deepEqual(fresh.result.missing, [
      'evidence:["0007","warehouse=W2;batch=B01"]',
      'evidence:["0007","warehouse=W1;batch=B02"]',
      'account:["INV-1","branch=02"]',
    ]);
    assert.equal(
      fresh.result.records[0].reduce(
        (total, record) => total + Number(record.values[5]),
        0,
      ),
      150000,
    );
    for (const lang of ['ar', 'en'] as const) {
      const copy = domainEvidenceCopy(lang);
      const before = structuredClone(fresh);
      const snapshot = {
        domain: 'inventory-register' as const,
        input: fresh.state,
        result: fresh.result,
      };
      const replay = async () => {
        const next = await replayStock(snapshot.input);
        return {
          domain: 'inventory-register' as const,
          input: next.state,
          result: next.result,
        };
      };
      const amounts = await askVerifiedSpecializedEvidence(
        snapshot,
        copy.questions.amounts,
        replay,
      );
      assert.deepEqual(
        amounts.facts.map((fact) => [fact.label, fact.subject, fact.value]),
        [
          ['supportedRegister', 'register', 60000],
          ['carrying', 'gl', 150000],
        ],
      );
      const status = await askVerifiedSpecializedEvidence(
        snapshot,
        copy.questions.status,
        replay,
      );
      assert.ok(
        status.facts.some(
          (fact) => fact.label === 'missing' && fact.value === 3,
        ),
      );
      assert.ok(
        status.facts.some(
          (fact) => fact.label === 'review' && fact.value === 'needs-review',
        ),
      );
      assert.deepEqual(fresh, before);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
