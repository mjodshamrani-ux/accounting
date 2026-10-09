// Full browser scenarios require generated synthetic XLSX and session inputs.
// Prepare them on fresh worktrees; the frozen CSV originals remain untouched.
const preparations = await Promise.allSettled([
  import('../audit/bank/export-fixture.mjs'),
  import('../audit/bank-adjustment/export-fixture.mjs'),
  import('../audit/bank-adjustment/prepare-browser-fixtures.mjs'),
]);
const failures = preparations
  .filter((result) => result.status === 'rejected')
  .map((result) => result.reason);
if (failures.length)
  throw new AggregateError(failures, 'Synthetic browser fixture preparation failed');
