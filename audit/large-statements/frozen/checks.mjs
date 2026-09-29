import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const contracts = JSON.parse(await readFile(path.join(here, 'contracts.json'), 'utf8'));
const imports = new Map();
export async function verifyFrozen() {
  const manifest = await readFile(path.join(here, 'SHA256SUMS'));
  for (const line of manifest.toString().trim().split('\n')) {
    const [digest, name] = line.split('  ');
    assert.equal(sha(await readFile(path.join(here, name))), digest, `Frozen artifact changed: ${name}`);
  }
  return sha(manifest);
}
async function apiAt(root) {
  if (!imports.has(root)) imports.set(root, (async () => {
    const module = (name) => import(pathToFileURL(path.join(root, 'lib/reconciliation', name)).href);
    return { ...await module('io.ts'), ...await module('supplier-reconciliation.ts'), ...await module('session.ts'), ...await module('input-readiness.ts'), normalizeSource:(await module('core.ts')).normalizeSource, constants: await module('types.ts') };
  })());
  return imports.get(root);
}
async function input(name) {
  const bytes = await readFile(path.join(here, 'fixtures', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function errorFacts(error) {
  return { name: error?.name, message: error?.message, diagnosis: error?.diagnosis, cause: error?.cause ? errorFacts(error.cause) : undefined };
}
function errorText(error) {
  return [error?.message, error?.cause ? errorText(error.cause) : ''].join('\n');
}
function sourceFacts(source) {
  return source.transactions.map((t) => ({ reference:t.reference, date:t.date, amountMinor:t.amount, sourcePage:t.sourcePage, row:t.row }));
}

export async function evaluateContract(engineRoot, id) {
  await verifyFrozen();
  const contract = contracts.cases.find((c) => c.id === id);
  assert.ok(contract, `Unknown contract ${id}`);
  const root = path.resolve(engineRoot), api = await apiAt(root);
  const failures = [], timings = {}, start = performance.now();
  const check = (label, fn) => { try { fn(); } catch (error) { failures.push({label, message:error.message.slice(0,5000)}); } };
  let observed = {}, operationException;
  try {
    assert.equal(api.constants.MAX_ROWS, contracts.unchangedBudgets.maxRows);
    assert.equal(api.constants.MAX_FILE_BYTES, contracts.unchangedBudgets.maxBytes);
    const bytes = await input(contract.file);
    assert.ok(bytes.byteLength <= contracts.unchangedBudgets.maxBytes);
    let file, failure;
    const readStart = performance.now();
    try { file = await api.readFile(contract.file, bytes, contracts.pdfCuts); }
    catch (error) { failure = error; }
    timings.readMs = performance.now() - readStart;
    if (['limit-rejection','empty-page','covered-page','stream-rejection'].includes(contract.kind)) {
      observed = { sourceReturned:!!file, error:failure ? errorFacts(failure) : null };
      check('The entire source is rejected, with no accepted prefix', () => { assert.ok(failure, 'Expected the source read to reject'); assert.equal(file, undefined); });
      if (contract.kind === 'limit-rejection') check('The supported limit is explicitly 100 pages', () => assert.match(errorText(failure), /100/));
      else {
        check('The rejection identifies the late failing page', () => assert.ok(failure?.diagnosis?.page === contract.failurePage || new RegExp(`(?:^|\\D)${contract.failurePage}(?:\\D|$)`).test(errorText(failure)), errorText(failure)));
        if (contract.kind === 'empty-page') check('Empty-page diagnosis remains bounded and does not claim complete inspection', () => {
          assert.equal(failure?.diagnosis?.code, 'PDF_NO_EXTRACTABLE_TEXT');
          assert.equal(failure?.diagnosis?.page, 70);
          assert.equal(failure?.diagnosis?.totalPages, 70);
          assert.equal(failure?.diagnosis?.inspectedAllPages, false);
        });
        if (contract.kind === 'covered-page') check('Coverage failure is not an unrelated page-count refusal', () => assert.match(errorText(failure), /رسم|يغطي|تحجب|مغط|مرئي|ظاهر|covered|visible/i));
        if (contract.kind === 'stream-rejection') check('A malformed late operator stream remains an integrity failure', () => assert.match(errorText(failure), /تعليمات عرض|اكتمال|stream/i));
      }
    } else {
      if (failure) throw failure;
      const oracle = JSON.parse(await readFile(path.join(here, 'fixtures', contract.oracle), 'utf8'));
      assert.ok(file);
      check('Original PDF bytes, page count and every extracted row are retained', () => {
        assert.deepEqual(file.original, bytes);
        assert.equal(file.pdf?.pages, oracle.pages);
        assert.equal(file.sheets[0].rows.length, oracle.extractedRows);
        assert.equal(Object.keys(file.sheets[0].rowPages).length, oracle.extractedRows);
      });
      const ledger = await api.readFile(contract.ledger, await input(contract.ledger));
      const mappings = [structuredClone(contracts.mapping), {...structuredClone(contracts.mapping),pdfReviewed:false}];
      const scope = structuredClone(contracts.scope);
      const normalizeStart = performance.now();
      let computed, readinessRefusal;
      try { computed = api.reconcileSupplierStatement({files:[file,ledger],mappings,scope,decisions:[],rejected:[]}); }
      catch(error) {
        if (contract.kind !== 'geometry-drift' || !api.isInputReadinessRejection(error)) throw error;
        readinessRefusal = errorFacts(error);
      }
      timings.normalizeAndCompareMs = performance.now() - normalizeStart;
      const result = computed?.result;
      const supplier = result?.supplier ?? api.normalizeSource(file,mappings[0],scope,'supplier');
      if (contract.kind === 'geometry-drift') {
        const issues = Object.entries(file.sheets[0].rowIssues ?? {}).filter(([row]) => file.sheets[0].rowPages[row] === 100);
        check('Final-page geometry drift is visible', () => assert.ok(issues.length >= oracle.movementsPerPage));
        check('Unresolved final-page columns cannot approve an earlier prefix', () => assert.equal(result?.matches.length??0,0));
        check('All page-100 monetary movements are retained as explicit read errors', () => {
          const expectedRows = oracle.transactions.filter((r) => r.sourcePage === 100).map((r) => r.supplierSourceRow);
          for (const row of expectedRows) assert.ok(supplier.errors.some((e) => e.row === row),`Missing read error at source row ${row}`);
          for (const fact of oracle.transactions.filter((r) => r.sourcePage === 100)) assert.ok(file.sheets[0].rows[fact.supplierSourceRow-1].some((cell) => cell.includes(fact.amount)),`Monetary text lost at ${fact.supplierSourceRow}`);
        });
        observed = {pages:file.pdf.pages, extractedRows:file.sheets[0].rows.length, latePageIssues:issues.length, automaticMatches:result?.matches.length??0, sourceErrors:supplier.errors, readinessRefusal};
      } else {
        assert.ok(result);assert.ok(computed);
        check('Every literal source transaction keeps its reference, signed amount, date, row and page', () => assert.deepEqual(sourceFacts(result.supplier),oracle.transactions.map((r) => ({reference:r.reference,date:r.date,amountMinor:r.amountMinor,sourcePage:r.sourcePage,row:r.supplierSourceRow}))));
        check('All required pairs succeed, including every last-page movement', () => {
          assert.equal(result.matches.length,oracle.requiredPairs);
          const left = new Map(result.supplier.transactions.map((t) => [t.id,t]));
          const right = new Map(result.ledger.transactions.map((t) => [t.id,t]));
          const actual = result.matches.map((m) => {
            assert.equal(m.kind,'auto');assert.equal(m.supplierIds?.length??1,1);assert.equal(m.ledgerIds?.length??1,1);
            const s=left.get(m.supplierId),l=right.get(m.ledgerId);return [s?.row,l?.row,s?.reference,l?.reference];
          }).sort((a,b) => a[0]-b[0]);
          assert.deepEqual(actual,oracle.transactions.map((r) => [r.supplierSourceRow,r.ledgerSourceRow,r.reference,r.reference]));
        });
        check('Repeated headers, page totals and carried/closing balances are excluded with reasons', () => {
          assert.deepEqual(result.supplier.excluded.map((r) => r.row).sort((a,b)=>a-b),oracle.excluded.map((r)=>r.row));
          assert.ok(result.supplier.excluded.every((r) => r.reason?.trim()));
          assert.deepEqual(result.supplier.errors,[]);assert.deepEqual(result.ledger.errors,[]);
        });
        check('The exact signed total agrees with the literal oracle', () => assert.equal(result.supplier.transactions.reduce((sum,t)=>sum+t.amount,0),oracle.totalMinor));
        observed = {pages:file.pdf.pages,extractedRows:file.sheets[0].rows.length,requiredPairs:oracle.requiredPairs,actualPairs:result.matches.length,lastRequiredReference:oracle.lastRequiredReference,lastSourcePage:result.supplier.transactions.at(-1)?.sourcePage,totalMinor:result.supplier.transactions.reduce((sum,t)=>sum+t.amount,0),excluded:result.supplier.excluded.length};
        if (contract.roundtrip) {
          const sessionStart=performance.now();
          const saved=await api.saveSession({files:[file,ledger],mappings:computed.mappings,scope,decisions:[],rejected:[],events:[],review:{name:'Synthetic acceptance',notes:'',checked:false}});
          const restored=await api.restoreSession(saved);timings.saveAndRestoreMs=performance.now()-sessionStart;
          check('Session restoration re-proves all required pairs and page provenance',()=>{assert.equal(restored.result.matches.length,oracle.requiredPairs);assert.deepEqual(sourceFacts(restored.result.supplier),sourceFacts(result.supplier));});
          const exportStart=performance.now();
          const workbook=await api.exportWorkbook(restored.result,restored.files,{name:'Synthetic acceptance',notes:'',checked:false});
          timings.exportMs=performance.now()-exportStart;
          const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(workbook);
          const source=book.getWorksheet('Supplier transactions');
          check('Export includes every source transaction and the original late page and amounts',()=>{
            assert.ok(source);assert.equal(source.rowCount,oracle.requiredPairs+1);
            for(let i=0;i<oracle.transactions.length;i++){const fact=oracle.transactions[i],r=source.getRow(i+2);assert.equal(r.getCell(3).value,fact.supplierSourceRow);assert.equal(r.getCell(5).value,fact.reference);assert.equal(Math.round(Number(r.getCell(8).value)*100),fact.amountMinor);assert.equal(r.getCell(10).value,fact.sourcePage);}
          });
          observed.sessionBytes=saved.byteLength;observed.workbookBytes=workbook.byteLength;
        }
      }
      check('Every supplier source row has one visible disposition',()=>{
        const rows=[...supplier.transactions,...supplier.excluded,...supplier.errors].map((r)=>r.row);
        const unique=[...new Set(rows)].sort((a,b)=>a-b);assert.deepEqual(unique,Array.from({length:file.sheets[0].rows.length},(_,i)=>i+1));
      });
    }
  } catch(error) { operationException=errorFacts(error);failures.push({label:'Production operation exception',message:error.stack?.slice(0,6000)??error.message}); }
  timings.totalMs=performance.now()-start;
  return {id,kind:contract.kind,pass:failures.length===0,failures,observed,operationException,timings,processMemory:{rssMiB:process.memoryUsage().rss/1048576,heapUsedMiB:process.memoryUsage().heapUsed/1048576,cumulativeProcessPeakRssMiB:process.resourceUsage().maxRSS/1024},engineVersion:api.constants.ENGINE_VERSION};
}
