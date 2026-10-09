import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MultilineSourceReviewController } from '../lib/reconciliation/multiline-source-review.ts';
import {
  multilineSourceReviewCopy,
  multilineSourceReviewDemo,
} from '../lib/i18n/multiline-source-review.ts';
const base = new URL(
  '../audit/local-provider/multiline-source-v1/frozen/',
  import.meta.url,
);
const original = new Uint8Array(
  await readFile(new URL('en-distractors.txt', base)),
);
async function loaded() {
  const controller = new MultilineSourceReviewController();
  assert.equal(
    await controller.finishSource(
      controller.beginSource('original-invoice.txt'),
      original,
    ),
    true,
  );
  return controller;
}
void test('reachable review adapter proposes literal roles and confers no financial approval', async () => {
  const controller = await loaded();
  assert.equal(controller.view.phase, 'candidate');
  assert.equal(
    controller.view.originalText,
    new TextDecoder().decode(original),
  );
  assert.equal(controller.view.synthetic, false);
  assert.ok(controller.view.bound);
  assert.equal(controller.view.bound.productEnabled, false);
  assert.equal(controller.view.bound.fields.date, '2026-09-12');
  assert.equal(controller.view.bound.fields.reference, 'INV-412');
  assert.equal(controller.view.bound.fields.amount, '115.00');
  assert.equal(controller.view.reviewer, null);
  assert.equal(controller.view.applied, null);
  assert.equal(await controller.apply(), null);
  assert.equal(
    controller.recordReview(
      'synthetic UI tester',
      'literal roles checked',
      false,
      'accept',
    ),
    false,
  );
  assert.equal(
    controller.recordReview('', 'literal roles checked', true, 'accept'),
    false,
  );
});
void test('explicit reviewer action and acknowledgement permit derived replay without financial autoload', async () => {
  const controller = await loaded();
  assert.equal(
    controller.recordReview(
      'synthetic UI tester; not a field trial',
      'separate test click checked literal values and labels',
      true,
      'accept',
    ),
    true,
  );
  assert.equal(controller.view.phase, 'approved');
  const result = await controller.apply();
  assert.ok(result);
  assert.equal(controller.view.phase, 'applied');
  assert.equal(result.productEnabled, false);
  assert.equal(result.derived.kind, 'explicitly-derived-csv');
  assert.equal(result.engine.amountMinor, '11500');
  assert.notEqual(result.derived.sha256, result.originalSha256);
  assert.equal(result.originalText, new TextDecoder().decode(original));
  assert.equal(await controller.apply(), null);
  assert.equal('files' in controller.view, false);
  assert.equal('comparison' in controller.view, false);
  assert.equal('financialApproval' in controller.view, false);
});
void test('selection and reviewer edits, reread version and replacement bytes revoke previous review', async () => {
  for (const action of [
    'selection',
    'reviewer',
    'reread',
    'replacement',
  ] as const) {
    const controller = await loaded();
    const priorRevision = controller.view.extractionRevision;
    const priorHash = controller.view.originalSha256;
    assert.equal(
      controller.recordReview(
        'synthetic reviewer',
        'synthetic rationale',
        true,
        'accept',
      ),
      true,
    );
    if (action === 'selection')
      await controller.select(['date', 'reference', 'currency']);
    if (action === 'reviewer') await controller.invalidateReview();
    if (action === 'reread') await controller.reread();
    if (action === 'replacement') {
      const changed = new TextEncoder().encode(
        new TextDecoder().decode(original).replace('115.00\n', '116.00\n'),
      );
      await controller.finishSource(
        controller.beginSource('changed.txt'),
        changed,
      );
      assert.notEqual(controller.view.originalSha256, priorHash);
    }
    assert.equal(controller.view.phase, 'candidate', action);
    assert.equal(controller.view.reviewer, null);
    assert.equal(controller.view.applied, null);
    assert.equal(await controller.apply(), null);
    if (action === 'reread') {
      assert.notEqual(controller.view.extractionRevision, priorRevision);
      assert.equal(controller.view.originalSha256, priorHash);
    }
  }
});
void test('source replacement, cancel and reviewer edits discard pending Apply without stale output', async () => {
  for (const action of [
    'replacement',
    'cancel',
    'reviewer',
    'reread',
  ] as const) {
    const controller = await loaded();
    controller.recordReview(
      'synthetic reviewer',
      'synthetic test decision',
      true,
      'accept',
    );
    const applying = controller.apply();
    assert.equal(controller.view.phase, 'applying');
    if (action === 'replacement')
      await controller.finishSource(
        controller.beginSource('replacement.txt'),
        original,
      );
    if (action === 'cancel') controller.clear();
    if (action === 'reviewer') await controller.invalidateReview();
    if (action === 'reread') await controller.reread();
    assert.equal(await applying, null, action);
    assert.equal(controller.view.applied, null, action);
    assert.equal(controller.view.reviewer, null, action);
    assert.equal(
      controller.view.phase,
      action === 'cancel' ? 'empty' : 'candidate',
      action,
    );
  }
});
void test('pending source reads and selections cannot overwrite replacement or cancel', async () => {
  const controller = new MultilineSourceReviewController();
  const oldTicket = controller.beginSource('old.txt');
  const pendingSource = controller.finishSource(oldTicket, original);
  const newTicket = controller.beginSource('new.txt');
  assert.equal(await pendingSource, false);
  assert.equal(await controller.finishSource(oldTicket, original), false);
  assert.equal(await controller.finishSource(newTicket, original), true);
  assert.equal(controller.view.name, 'new.txt');
  const pendingSelection = controller.select(['date']);
  controller.clear();
  assert.equal(await pendingSelection, false);
  assert.equal(controller.view.phase, 'empty');
});
void test('unsupported sources and rejection cannot mint an Apply receipt', async () => {
  const controller = new MultilineSourceReviewController();
  const unsupported = new Uint8Array(
    await readFile(new URL('source-instructions.txt', base)),
  );
  await controller.finishSource(
    controller.beginSource('instructions.txt'),
    unsupported,
  );
  assert.equal(controller.view.phase, 'abstain');
  assert.equal(
    controller.recordReview(
      'synthetic tester',
      'must not override source',
      true,
      'accept',
    ),
    false,
  );
  assert.equal(await controller.apply(), null);
  const rejected = await loaded();
  assert.equal(
    rejected.recordReview(
      'synthetic tester',
      'test rejects source',
      false,
      'reject',
    ),
    true,
  );
  assert.equal(rejected.view.phase, 'rejected');
  assert.equal(await rejected.apply(), null);
});
void test('AR/EN source review copy states candidate and derived-only financial boundary', async () => {
  const en = multilineSourceReviewCopy('en');
  const ar = multilineSourceReviewCopy('ar');
  assert.match(en.boundary, /no financial approval/);
  assert.match(en.applied, /not been loaded/);
  assert.match(ar.boundary, /ليست اعتماداً مالياً/);
  assert.equal(en.toggle, 'Source interpretation review');
  assert.notEqual(ar.toggle, en.toggle);
  assert.equal(
    multilineSourceReviewDemo('en'),
    new TextDecoder().decode(original),
  );
  assert.equal(
    multilineSourceReviewDemo('ar'),
    await readFile(new URL('ar-distractors.txt', base), 'utf8'),
  );
});

void test('public view arrays and citation objects cannot diverge visible selections from the bound four fields', async () => {
  const emptyController = new MultilineSourceReviewController();
  assert.ok(Object.isFrozen(emptyController.view.selectedFields));
  assert.throws(
    () => (emptyController.view.selectedFields as string[]).push('amount'),
    TypeError,
  );
  const controller = await loaded();
  const view = controller.view;
  assert.ok(Object.isFrozen(view.selectedFields));
  assert.throws(() => (view.selectedFields as string[]).pop(), TypeError);
  assert.throws(
    () => (view.proposal!.selections as unknown as unknown[]).pop(),
    TypeError,
  );
  assert.throws(
    () => (view.bound!.selections as unknown as unknown[]).pop(),
    TypeError,
  );
  assert.throws(() => {
    (view.proposal!.selections[0].value as { literal: string }).literal =
      'forged visible literal';
  }, TypeError);
  assert.deepEqual(controller.view.selectedFields, [
    'date',
    'reference',
    'amount',
    'currency',
  ]);
  assert.equal(controller.view.bound!.selections.length, 4);
  assert.equal(
    controller.recordReview(
      'synthetic defensive API reviewer',
      'Visible fields still match their bounded citations.',
      true,
      'accept',
    ),
    true,
  );
  assert.equal((await controller.apply())!.engine.amountMinor, '11500');
});
