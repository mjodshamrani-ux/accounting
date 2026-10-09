import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile as fsRead, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
import { reconcileClearing } from '../lib/reconciliation/clearing.ts';
import { exportClearing } from '../lib/reconciliation/clearing-io.ts';
import { bankFixture } from '../audit/bank/fixtures.ts';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import { exportBank } from '../lib/reconciliation/bank-io.ts';
import {
  GL_TB_VERSION,
  reconcileGlTb,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import { exportGlTb } from '../lib/reconciliation/gl-tb-io.ts';

async function fixtures() {
  const load = async (path: string, name: string) =>
    readFile(
      name,
      new Uint8Array(await fsRead(new URL(path, import.meta.url))).buffer,
    );
  const clearing = {
    file: await load('../audit/clearing/frozen/source.csv', 'source.csv'),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  const bank = await bankFixture();
  const truth = JSON.parse(
    await fsRead(
      new URL('../audit/gl-tb/frozen/expected.json', import.meta.url),
      'utf8',
    ),
  );
  const gl: GlTbInput = {
    files: (await Promise.all(
      ['gl', 'tb'].map((side) =>
        load(`../audit/gl-tb/frozen/positive-${side}.csv`, `${side}.csv`),
      ),
    )) as GlTbInput['files'],
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
    scope: { ...truth.scope, confirmed: true },
  };
  return { clearing, bank, gl };
}

void test('proven clearing, bank and GL/TB source-name text loss is rejected or preserved without changing financial results', async () => {
  const { clearing, bank, gl } = await fixtures();
  const domains = [
    {
      name: 'clearing',
      rename: (name: string) => {
        clearing.file.name = name;
      },
      result: () => reconcileClearing(clearing),
      export: () => exportClearing(clearing, reconcileClearing(clearing)),
    },
    {
      name: 'bank',
      rename: (name: string) => {
        bank.files[0].name = name;
      },
      result: () => reconcileBank(bank),
      export: () => exportBank(bank, reconcileBank(bank)),
    },
    {
      name: 'gl-tb',
      rename: (name: string) => {
        gl.files[0].name = name;
      },
      result: () => reconcileGlTb(gl),
      export: () => exportGlTb(gl, reconcileGlTb(gl)),
    },
  ];
  const out = await mkdtemp(join(tmpdir(), 'tarasuf-related-export-text-'));
  try {
    const name =
      '= مصدر عربي 🧾 e\u0301\r\n_x0041_ _x000D_ _X0041_ _x005F_ _x005F_x0041_x000D_ _x0041__x0042_ \u007f.csv';
    for (const domain of domains) {
      for (const invalid of ['\u0001', '\uffff', '\ud800']) {
        domain.rename(`source${invalid}.csv`);
        const before = structuredClone(domain.result());
        await assert.rejects(domain.export(), /محارف|Unicode/);
        assert.deepEqual(domain.result(), before);
      }
      domain.rename(name);
      const before = structuredClone(domain.result());
      await writeFile(
        join(out, domain.name + '.xlsx'),
        new Uint8Array(await domain.export()),
      );
      assert.deepEqual(domain.result(), before);
    }
    await writeFile(join(out, 'expected.json'), JSON.stringify({ name }));
    const checker = new URL(
      '../audit/ar-limited/check_related_export_text.py',
      import.meta.url,
    ).pathname;
    const checked = JSON.parse(
      execFileSync('python3', [checker, out], { encoding: 'utf8' }),
    );
    assert.equal(checked.verified, true);
    assert.equal(checked.workbooks, 3);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
