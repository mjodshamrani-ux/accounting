import assert from 'node:assert/strict';
import test from 'node:test';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { intercompanyCopy } from '../lib/i18n/intercompany.ts';
import { gatewayCopy } from '../lib/i18n/payment-gateway.ts';
import { stockCopy } from '../lib/i18n/inventory-register.ts';
import { assetCopy } from '../lib/i18n/fixed-assets.ts';
import { payrollCopy } from '../lib/i18n/payroll.ts';
import { reconciliationDirectoryCopy } from '../lib/i18n/reconciliation-directory.ts';
import { acceptFormats, typeStageRoles } from '../lib/i18n/type-stage.ts';

// The stage names each role as its workspace names its file input, in the
// order the workspace shows its main sources (its primaryIndices).
const workspaceNames = (lang: 'ar' | 'en') => {
  const t = lang === 'ar' ? ar : en;
  return {
    supplier: t.app.sides,
    ar: t.arDocuments.sides,
    intercompany: intercompanyCopy[lang].roles.slice(0, 2),
    bank: t.bank.sides,
    clearing: [t.clearing.upload],
    allocation: t.allocation.sides.slice(0, 2),
    gateway: [gatewayCopy[lang].roles[0], gatewayCopy[lang].roles[2]],
    'gl-tb': t.glTb.sides,
    'tb-financial': [t.financial.roles[0], t.financial.roles[3]],
    stock: [stockCopy[lang].roles[0], stockCopy[lang].roles[3]],
    assets: [assetCopy[lang].roles[0], assetCopy[lang].roles[3]],
    payroll: [payrollCopy[lang].roles[0], payrollCopy[lang].roles[3]],
  };
};

void test('every role on the stage is the name its workspace gives its file input', () => {
  for (const lang of ['ar', 'en'] as const) {
    const names = workspaceNames(lang);
    const domains = Object.keys(reconciliationDirectoryCopy[lang]).filter(
      (key) => key in names,
    );
    assert.equal(domains.length, 12, `${lang}: the twelve types`);
    assert.deepEqual(
      Object.keys(typeStageRoles[lang]).sort(),
      Object.keys(names).sort(),
    );
    for (const [domain, expected] of Object.entries(names))
      assert.deepEqual(
        typeStageRoles[lang][domain as keyof typeof names].map(
          (role) => role.name,
        ),
        [...expected],
        `${lang} ${domain}`,
      );
  }
});

void test('each type has the same roles and formats in both languages', () => {
  for (const [domain, roles] of Object.entries(typeStageRoles.ar)) {
    const english = typeStageRoles.en[domain as keyof typeof typeStageRoles.en];
    assert.equal(roles.length, english.length, domain);
    assert.deepEqual(
      roles.map((role) => role.accept),
      english.map((role) => role.accept),
      domain,
    );
    assert.ok(roles.length === 1 || roles.length === 2, domain);
  }
  assert.equal(typeStageRoles.ar.clearing.length, 1, 'one record in clearing');
});

void test('formats read as the upload card writes them', () => {
  assert.equal(acceptFormats('.csv,.xlsx'), 'CSV / XLSX');
  assert.equal(acceptFormats('.xlsx,.csv,.pdf'), 'XLSX / CSV / PDF');
  assert.equal(acceptFormats(' .csv '), 'CSV');
  assert.equal(acceptFormats(undefined), '');
});
