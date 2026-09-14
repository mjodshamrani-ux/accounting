// Bounded offline lookup, verified 2026-09-14 against the ISO 4217 maintenance
// agency's List One (published 2026-01-01). Unknown codes need an explicit choice.
// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
const minorUnits: Record<string, 0 | 2 | 3> = {
  SAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};
export const currencyPrecision = (currency: string): 0 | 2 | 3 | undefined =>
  Object.hasOwn(minorUnits, currency) ? minorUnits[currency] : undefined;
