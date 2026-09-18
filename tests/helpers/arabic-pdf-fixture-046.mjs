import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const runtime =
  process.env.TARASUF_PDF_RUNTIME ??
  join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
const font =
  process.env.TARASUF_PDF_FONT ??
  join(
    runtime,
    'native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype/DejaVuSans.ttf',
  );
const python =
  process.env.TARASUF_PDF_PYTHON ?? join(runtime, 'python/bin/python3');
const soffice =
  process.env.TARASUF_PDF_SOFFICE ?? join(runtime, 'bin/override/soffice');
const extraPython =
  process.env.TARASUF_PDF_PYTHONPATH ??
  resolve(
    fileURLToPath(
      new URL(
        '../../../../work/engine-reliability-046/pdf-python',
        import.meta.url,
      ),
    ),
  );
const labels = {
  ar: {
    date: 'التاريخ',
    reference: 'رقم الفاتورة',
    amount: 'المبلغ',
    description: 'الوصف',
    type: 'نوع المستند',
  },
  mixed: {
    date: 'Date',
    reference: 'Reference',
    amount: 'Amount',
    description: 'الوصف',
    type: 'Type',
  },
};
export async function renderArabicStatement(options) {
  const {
    producer = 'reportlab',
    columns = ['description', 'amount', 'reference', 'date'],
    language = 'ar',
  } = options;
  const pages = options.pages ?? [
    {
      rows: [
        columns.map((c) => labels[language][c]),
        ...options.rows.map((r) => columns.map((c) => r[c] ?? '')),
      ],
      ...options.layout,
    },
  ];
  await access(font);
  const temp = await mkdtemp(join(tmpdir(), 'tarasuf-ar-pdf-'));
  try {
    const spec = join(temp, 'input.json'),
      out = join(temp, 'fixture.pdf');
    await writeFile(spec, JSON.stringify({ pages }));
    await exec(
      python,
      [
        fileURLToPath(new URL('./arabic-pdf-fixture-046.py', import.meta.url)),
        '--input',
        spec,
        '--output',
        out,
        '--font',
        font,
        '--producer',
        producer,
        ...(producer === 'libreoffice' ? ['--soffice', soffice] : []),
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: [extraPython, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(':'),
        },
        maxBuffer: 1024 * 1024,
      },
    );
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
