import test from 'node:test';
import assert from 'node:assert/strict';
import { getResolvedPDFJS } from 'unpdf';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  guardPdfOperatorStreams,
  PdfOperatorStreamError,
} from '../lib/reconciliation/pdf-stream-integrity.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const rows = [
  ['Date', 'Reference', 'Amount'],
  ['2026-07-01', 'INV-100', '100.00'],
];
// Enough harmless marks to flush an earlier operator chunk before a later
// malformed shading operator. The visible marks do not intersect any text.
const prefix = 'q 0 g 1 1 1 1 re f Q\n'.repeat(1000);
const version = '6.1.200';

void test('PDF stream integrity: a late malformed shading cannot leave a silently accepted financial prefix', async () => {
  await assert.rejects(
    readFile(
      'late-stream-error.pdf',
      syntheticPdf([rows], 10, prefix + '/Missing sh'),
      undefined,
      true,
    ),
    PdfOperatorStreamError,
  );
  // The same ordinary layout remains usable when the invalid operator is absent.
  const clean = await readFile(
    'complete-stream.pdf',
    syntheticPdf([rows], 10, prefix),
    undefined,
    true,
  );
  assert.deepEqual(clean.sheets[0].rows, rows);
  assert.deepEqual(clean.sheets[0].rowIssues, {});
});

void test('PDF stream integrity: early parser errors reject single-page and multipage imports', async () => {
  for (const pages of [[rows], [rows, rows]]) {
    await assert.rejects(
      readFile(
        'failed-stream.pdf',
        syntheticPdf(pages, 10, '/Missing sh'),
        undefined,
        true,
      ),
      PdfOperatorStreamError,
    );
  }
});

void test('PDF stream integrity: actual PDF.js prefix resolution cannot bypass the document-local guard', async () => {
  const { getDocument, version: actualVersion } = await getResolvedPDFJS();
  const loading = getDocument({
    data: new Uint8Array(syntheticPdf([rows], 10, prefix + '/Missing sh')),
    stopAtErrors: true,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    useWasm: false,
  });
  let guard: ReturnType<typeof guardPdfOperatorStreams> | undefined;
  try {
    const document = await loading.promise;
    guard = guardPdfOperatorStreams(document, actualVersion);
    const page = await document.getPage(1);
    const publicResult = await page.getOperatorList();
    assert.ok(
      publicResult.fnArray.length > 0,
      'PDF.js has already delivered a plausible prefix',
    );
    assert.equal(
      (publicResult as unknown as { lastChunk: boolean }).lastChunk,
      true,
      'The public completeness flag alone is not evidence',
    );
    await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
  } finally {
    guard?.restore();
    await loading.destroy();
  }
});

void test('PDF stream integrity: unsupported internals and a changed PDF.js version fail closed', () => {
  for (const document of [
    undefined,
    {},
    { _transport: {} },
    { _transport: { messageHandler: {} } },
  ])
    assert.throws(
      () => guardPdfOperatorStreams(document, version),
      PdfOperatorStreamError,
    );
  const document = {
    _transport: {
      messageHandler: {
        sendWithStream() {
          return new ReadableStream();
        },
      },
    },
  };
  assert.throws(
    () => guardPdfOperatorStreams(document, 'unreviewed-version'),
    PdfOperatorStreamError,
  );
});

void test('PDF stream integrity: successful stream must deliver its final chunk and close', async () => {
  const original = (..._args: unknown[]) =>
    new ReadableStream({
      start(controller) {
        controller.enqueue({ lastChunk: true });
        controller.close();
      },
    });
  const handler = { sendWithStream: original };
  const guard = guardPdfOperatorStreams(
    { _transport: { messageHandler: handler } },
    version,
  );
  const reader = handler.sendWithStream('GetOperatorList').getReader();
  assert.equal((await reader.read()).done, false);
  await reader.read();
  await guard.assertComplete();
  guard.restore();
  assert.equal(handler.sendWithStream, original);
  await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
});

void test('PDF stream integrity: an error after the apparent final chunk is still fatal', async () => {
  let counter = 0;
  const handler = {
    sendWithStream: (..._args: unknown[]) =>
      new ReadableStream({
        pull(controller) {
          if (counter++ === 0) controller.enqueue({ lastChunk: true });
          else controller.error(undefined);
        },
      }),
  };
  const guard = guardPdfOperatorStreams(
    { _transport: { messageHandler: handler } },
    version,
  );
  try {
    const reader = handler.sendWithStream('GetOperatorList').getReader();
    await reader.read();
    await assert.rejects(reader.read());
    await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
  } finally {
    guard.restore();
  }
});

void test('PDF stream integrity: truncated, cancelled and malformed stream contracts fail closed', async () => {
  for (const chunk of [{ lastChunk: false }, { missingFlag: true }]) {
    const handler = {
      sendWithStream: (..._args: unknown[]) =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          },
        }),
    };
    const guard = guardPdfOperatorStreams(
      { _transport: { messageHandler: handler } },
      version,
    );
    try {
      const reader = handler.sendWithStream('GetOperatorList').getReader();
      try {
        while (!(await reader.read()).done) {
          /* consume */
        }
      } catch {
        /* asserted independently below */
      }
      await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
    } finally {
      guard.restore();
    }
  }
  const handler = {
    sendWithStream: (..._args: unknown[]) => new ReadableStream(),
  };
  const guard = guardPdfOperatorStreams(
    { _transport: { messageHandler: handler } },
    version,
  );
  try {
    await handler.sendWithStream('GetOperatorList').cancel('cancelled');
    await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
  } finally {
    guard.restore();
  }
});

void test('PDF stream integrity: unrelated text streams are untouched and a restored document does not affect another', async () => {
  const textStream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
  const handler = { sendWithStream: (..._args: unknown[]) => textStream };
  const otherHandler = { sendWithStream: handler.sendWithStream };
  const guard = guardPdfOperatorStreams(
    { _transport: { messageHandler: handler } },
    version,
  );
  assert.equal(handler.sendWithStream('GetTextContent'), textStream);
  assert.equal(otherHandler.sendWithStream('GetOperatorList'), textStream);
  await assert.rejects(guard.assertComplete(), PdfOperatorStreamError);
  guard.restore();
});
