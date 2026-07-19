/**
 * Release sweep: every sellable custom-message configuration must produce a
 * kit whose frozen catalog packing yields a fully supported assembly plan.
 * Exits non-zero on the first regression (e.g. a holder cutting the backing
 * plate behind a glyph, or a letter depth no brick can physically anchor).
 */
import type { LibraryEntry } from '../src/data/carLibrary';
import { brickify } from '../src/lib/brickify';
import { createAssemblyPlan } from '../src/lib/instructions/assemblyPlan';
import { buildProceduralLibraryProfile } from '../src/lib/proceduralLibrary';

const entry: LibraryEntry = {
  category: 'object', defaultColor: '#D7263D', icon: 'Aa', id: 'custom-message', meshUrl: null,
  name: 'Custom Message', proceduralKey: 'custom-message', supportsHolder: true, tags: ['personalise'],
};

// Four messages cover the failure surface: every A-Z glyph, digits, the
// floating O top bar, multi-line wrapping, and single-glyph edge cases.
const MESSAGES = [
  'HELLO O 9', 'OO OO OO', 'ABCDEFG HIJKLMN OPQRSTU VWXYZ', '0123456 789',
];

let failures = 0;
let checks = 0;
for (const message of MESSAGES) {
  for (const size of ['efficient', 'balanced'] as const) {
    for (const holder of ['freestanding', 'wall', 'flat'] as const) {
      for (const font of ['block', 'rounded', 'stencil'] as const) {
        const model = buildProceduralLibraryProfile(entry, '#D7263D', { font, holder, message, size }, size);
        for (const hollow of [false, true]) {
          checks += 1;
          const bom = brickify(model, '#D7263D', hollow ? { hollow: true } : undefined);
          const plan = createAssemblyPlan(bom);
          const errors = plan.warnings.filter((w) => w.severity === 'error');
          if (plan.supportSummary.unsupported > 0 || errors.length > 0) {
            failures += 1;
            console.log(`FAIL ${JSON.stringify(message)} ${size}/${holder}/${font}/${hollow ? 'hollow' : 'full'}: unsupported=${plan.supportSummary.unsupported} ${errors[0]?.message ?? ''}`);
          }
        }
      }
    }
  }
}
console.log(`${checks} configurations checked, ${failures} failures`);
if (failures > 0) process.exit(1);
