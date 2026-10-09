import assert from 'node:assert/strict';
import { readFile as fsRead, writeFile } from 'node:fs/promises';
import { balanceFixture } from '../../../audit/bank-balance/fixtures.ts';
import { bankFixture } from '../../../audit/bank/fixtures.ts';
import { readFile } from '../../../lib/reconciliation/io.ts';
import { reconcileBank } from '../../../lib/reconciliation/bank.ts';
import { reconcileBankBalances } from '../../../lib/reconciliation/bank-balance.ts';
import { replayBankBalances,saveBankBalances,restoreBankBalances,exportBankBalances } from '../../../lib/reconciliation/bank-balance-io.ts';
const root='work/independent-review/b2-evidence/';
const checks=[];
const encode=rows=>new TextEncoder().encode(rows.map(row=>row.join(',')).join('\n')+'\n').buffer;
// Two separate valid B1 cases stay individually within the limit, but the whole
// period has a movement total beyond it; B2 must reject the complete operation.
const state=await balanceFixture();
state.bank=await bankFixture('individual');
for(const side of [0,1]){
 const [header,base]=state.bank.files[side].sheets[0].rows;
 const rows=[header,...[1,2].map(n=>{const row=[...base];row[0]=`${side?'L':'B'}${n}`;row[1]=`S${n}`;row[16]='600000000000.00';return row;})];
 const bytes=encode(rows);await writeFile(root+`large-movements-${side}.csv`,new Uint8Array(bytes));
 state.bank.files[side]=await readFile(`large-movements-${side}.csv`,bytes);
}
assert.equal(reconcileBank(state.bank).status,'movements-consistent');
assert.throws(()=>reconcileBankBalances(state),/BALANCE_SUM/);
await assert.rejects(saveBankBalances(state),/BALANCE_SUM/);
checks.push({name:'two valid B1 cases aggregate movement exceeds B2 bound',b1Status:'movements-consistent',reject:'BALANCE_SUM',saveRejected:true});
// Valid movements with opposite signs must all retain membership, even when a
// large intermediate period sum later cancels to an in-range final total.
for(const side of [0,1]){
 const rows=state.bank.files[side].sheets[0].rows.map(r=>[...r]);
 const back=[...rows[1]];back[0]=`${side?'L':'B'}3`;back[1]='S3';back[4]='inflow';rows.push(back);
 const bytes=encode(rows);await writeFile(root+`cancelled-movements-${side}.csv`,new Uint8Array(bytes));
 state.bank.files[side]=await readFile(`cancelled-movements-${side}.csv`,bytes);
 const balances=state.files[side].sheets[0].rows.map(r=>[...r]);balances[1][11]='600000000000.00';balances[2][11]='0.00';
 const original=encode(balances);await writeFile(root+`cancelled-balances-${side}.csv`,new Uint8Array(original));
 state.files[side]=await readFile(`cancelled-balances-${side}.csv`,original);
}
const r=reconcileBankBalances(state);assert.equal(r.status,'balances-consistent');
assert.deepEqual(r.components.map(c=>c.movement),[-60000000000000,-60000000000000]);assert.equal(r.components.flatMap(c=>c.movementIds).length,6);
checks.push({name:'whole-period cancellation computes final BigInt total',status:r.status,componentMembers:6});
// A valid forged parsed B1 amount changes a real result, but replay uses its
// original bytes; session and export must follow those originals as well.
const cache=await balanceFixture('balanced');const expected=reconcileBankBalances(cache);
cache.bank.files[0].sheets[0].rows[1][16]='1017.24';
const forged=reconcileBankBalances(cache);assert.equal(forged.status,'inconsistent');
assert.deepEqual((await replayBankBalances(cache)).result,expected);
const session=await saveBankBalances(cache);assert.deepEqual((await restoreBankBalances(session)).result,expected);
await assert.rejects(exportBankBalances(cache,forged),/BALANCE_STALE_EXPORT/);
await writeFile(root+'original-b1-cache-session.json',new Uint8Array(session));
await writeFile(root+'original-b1-cache-export.xlsx',new Uint8Array(await exportBankBalances(cache,expected)));
checks.push({name:'valid B1 parsed cache does not replace original',forgedStatus:forged.status,replayRestores:true,sessionRestores:true,staleRejected:true});
const result={sha:'d6a054f36955288a97386e2d5b2d788d83e49c69',allPassed:true,checks};
await writeFile(root+'independent-financial.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
