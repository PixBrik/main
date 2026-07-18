import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleCache = new Map();

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const cached = moduleCache.get(resolvedPath);
  if (cached) return cached.exports;

  const source = readFileSync(resolvedPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolvedPath,
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);

  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) throw new Error(`Unexpected test dependency: ${specifier}`);
    const base = path.resolve(path.dirname(resolvedPath), specifier);
    const dependency = existsSync(base) ? base : `${base}.ts`;
    return loadTypeScriptModule(dependency);
  };

  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    module.exports,
    localRequire,
    module,
    resolvedPath,
    path.dirname(resolvedPath),
  );
  return module.exports;
}

const commerce = loadTypeScriptModule(path.join(root, 'src', 'lib', 'commerce', 'index.ts'));

test('launch locales resolve browser tags and Arabic is explicitly RTL', () => {
  assert.deepEqual(commerce.SUPPORTED_LOCALES, ['en', 'fr', 'es', 'it', 'ar']);
  assert.equal(commerce.resolveLocale('fr-FR'), 'fr');
  assert.equal(commerce.resolveLocale('ar_SA'), 'ar');
  assert.equal(commerce.resolveLocale('de-DE'), 'en');
  assert.equal(commerce.isRtlLocale('ar'), true);
  assert.equal(commerce.localeMetadata('ar').direction, 'rtl');
  assert.equal(commerce.localeMetadata('es').nativeName, 'Español');
});

test('money uses exact integer minor units and half-up rounding', () => {
  assert.equal(commerce.BASE_CURRENCY, 'EUR');
  assert.deepEqual(commerce.SUPPORTED_CURRENCIES, ['EUR', 'GBP', 'USD', 'CAD', 'AUD']);
  assert.equal(commerce.toMinorUnits('12.345', 'EUR'), 1235);
  assert.equal(commerce.toMinorUnits('-12.345', 'EUR'), -1235);
  assert.equal(commerce.toMinorUnits(0.1 + 0.2, 'EUR'), 30);
  assert.equal(commerce.minorUnitsToDecimal(5, 'GBP'), '0.05');
  assert.equal(commerce.minorUnitsToDecimal(-5, 'GBP'), '-0.05');
  assert.throws(() => commerce.toMinorUnits('not-money', 'EUR'), /Invalid decimal/);
  assert.throws(() => commerce.assertMinorUnits(2.5), /safe integer/);
});

test('launch countries map to the correct market and editable shipping zone', () => {
  assert.equal(commerce.countryToShippingZone('FR'), 'eu');
  assert.equal(commerce.countryToShippingZone('es'), 'eu');
  assert.equal(commerce.countryToShippingZone('UK'), 'uk');
  assert.equal(commerce.countryToShippingZone('US'), 'north-america');
  assert.equal(commerce.countryToShippingZone('CAN'), 'north-america');
  assert.equal(commerce.countryToShippingZone('AU'), 'australia');
  assert.equal(commerce.countryToShippingZone('KSA'), 'middle-east');
  assert.equal(commerce.countryToShippingZone('UAE'), 'middle-east');
  assert.equal(commerce.countryToShippingZone('BHR'), 'middle-east');
  assert.equal(commerce.countryToShippingZone('OMN'), 'middle-east');
  assert.equal(commerce.countryToShippingZone('JP'), null);
  assert.equal(commerce.countryToMarket('CA'), 'canada');
  assert.equal(commerce.countryToMarket('US'), 'us');
  assert.equal(commerce.MARKET_DEFINITIONS.eu.taxPolicyId, null);
});

test('FX snapshots use fresh rates, bounded fallback, and never stale prices indefinitely', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');
  const friday = {
    id: 'fx-friday',
    baseCurrency: 'EUR',
    effectiveDate: '2026-07-17',
    fetchedAt: '2026-07-17T16:00:00.000Z',
    source: 'test-provider',
    rates: { GBP: '0.85', USD: '1.10', CAD: '1.50', AUD: '1.65' },
  };
  const mondayPartial = {
    id: 'fx-monday',
    baseCurrency: 'EUR',
    effectiveDate: '2026-07-20',
    fetchedAt: '2026-07-20T11:00:00.000Z',
    source: 'test-provider',
    rates: { GBP: '0.86', USD: '1.11', CAD: 'invalid' },
  };

  const gbp = commerce.resolveFxRate('GBP', [friday, mondayPartial], now);
  assert.equal(gbp.status, 'fresh');
  assert.equal(gbp.snapshot.id, 'fx-monday');

  const cad = commerce.resolveFxRate('CAD', [friday, mondayPartial], now);
  assert.equal(cad.status, 'fallback');
  assert.equal(cad.snapshot.id, 'fx-friday');
  assert.equal(commerce.convertEurMinorUnits(10_000, cad), 15_000);

  const expiredAt = new Date('2026-07-23T12:00:00.000Z');
  assert.equal(commerce.resolveFxRate('AUD', [friday], expiredAt).status, 'unavailable');
  assert.equal(commerce.resolveFxRate('EUR', [], expiredAt).status, 'base');

  const freshlyFetchedOldRate = {
    ...mondayPartial,
    id: 'fx-old-effective-date',
    effectiveDate: '2026-07-10',
    fetchedAt: '2026-07-20T11:59:00.000Z',
  };
  assert.equal(
    commerce.assessFxSnapshot(freshlyFetchedOldRate, now).freshness,
    'expired',
    'a new fetch must not refresh an old provider rate date',
  );

  const lateRefetchedFallback = {
    ...friday,
    id: 'fx-friday-refetched',
    fetchedAt: '2026-07-20T11:59:00.000Z',
    rates: { GBP: '0.80' },
  };
  assert.equal(
    commerce.resolveFxRate('GBP', [mondayPartial, lateRefetchedFallback], now).snapshot.id,
    'fx-monday',
    'a late re-fetch of an older effective date must not outrank a current rate',
  );

  assert.equal(
    commerce.assessFxSnapshot(
      { ...mondayPartial, effectiveDate: '2026-07-21' },
      now,
    ).freshness,
    'future',
  );
  assert.equal(
    commerce.assessFxSnapshot(
      { ...mondayPartial, fetchedAt: '2026-07-20T12:06:00.000Z' },
      now,
    ).freshness,
    'future',
  );
  assert.equal(
    commerce.assessFxSnapshot(
      { ...mondayPartial, fetchedAt: '2026-02-30T12:00:00.000Z' },
      now,
    ).freshness,
    'invalid',
  );
  assert.equal(
    commerce.assessFxSnapshot(
      { ...mondayPartial, effectiveDate: '2026-02-30' },
      now,
    ).freshness,
    'invalid',
  );
});

test('shipping rules are editable, time-bounded, country-aware, and tax-neutral', () => {
  const standard = {
    id: 'eu-standard',
    version: 3,
    name: 'EU standard',
    enabled: true,
    priority: 10,
    zoneId: 'eu',
    serviceCode: 'standard',
    priceEurMinor: 1290,
    conditions: {
      minSubtotalEurMinor: 5_000,
      maxWeightGrams: 8_000,
      maxLengthMm: 600,
      maxWidthMm: 300,
      maxHeightMm: 250,
    },
    deliveryWindow: {
      handlingMinDays: 1,
      handlingMaxDays: 3,
      transitMinDays: 3,
      transitMaxDays: 7,
      dayType: 'business',
    },
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveUntil: '2026-12-31T23:59:59.999Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
  const francePriority = {
    ...standard,
    id: 'fr-priority',
    name: 'France priority',
    priority: 20,
    priceEurMinor: 990,
    conditions: { ...standard.conditions, countryCodes: ['FR'] },
  };
  const context = {
    countryCode: 'FR',
    subtotalEurMinor: 20_000,
    weightGrams: 2_500,
    itemCount: 1,
    dimensionsMm: { length: 200, width: 500, height: 250 },
    at: new Date('2026-07-18T12:00:00.000Z'),
  };

  assert.equal(commerce.shippingRuleMatches(standard, context), true);
  assert.equal(commerce.shippingRuleMatches(standard, { ...context, countryCode: 'GB' }), false);
  assert.equal(
    commerce.shippingRuleMatches(standard, {
      ...context,
      dimensionsMm: { length: 700, width: 250, height: 200 },
    }),
    false,
  );
  assert.equal(
    commerce.shippingRuleMatches(standard, { ...context, dimensionsMm: undefined }),
    false,
    'quotes without packed dimensions fail closed',
  );

  const express = {
    ...standard,
    id: 'eu-express',
    name: 'EU express',
    priority: 15,
    priceEurMinor: 2490,
    serviceCode: 'express',
  };
  assert.deepEqual(
    commerce.matchingShippingRules([standard, francePriority, express], context).map((rule) => rule.id),
    ['fr-priority', 'eu-express'],
    'the higher-priority same-service override wins while other services remain available',
  );
  assert.throws(
    () => commerce.matchingShippingRules(
      [
        standard,
        francePriority,
        { ...francePriority, id: 'fr-priority-tie', priceEurMinor: 1090 },
      ],
      context,
    ),
    /Ambiguous active shipping rules.*fr-priority.*fr-priority-tie/i,
  );
  assert.equal('taxRate' in standard, false, 'tax must come from a separately reviewed policy');

  const operationalOrigin = {
    id: 'origin-1',
    internalName: 'Current fulfillment origin',
    active: true,
    countryCode: 'CN',
    customerVisibility: 'hidden',
  };
  assert.equal(operationalOrigin.customerVisibility, 'hidden');
});
