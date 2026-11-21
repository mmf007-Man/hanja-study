const fs = require('fs');
const vm = require('vm');

console.log('================================================================');
console.log('  Comprehensive Prototype Stroke Assist & Inspection Test Suite ');
console.log('================================================================\n');

// Mock window & DOM environment
const sandbox = {
  window: {},
  document: {
    addEventListener: () => {},
    querySelectorAll: () => [],
    getElementById: () => null
  },
  console: console,
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem: () => {} }
};
sandbox.window = sandbox;

function runInSandbox(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  vm.runInNewContext(code, sandbox, { filename: filePath });
}

// -------------------------------------------------------------
// Check 1: review-data.js (637 all & 159 high-priority)
// -------------------------------------------------------------
try {
  runInSandbox('prototype/stroke-assist/js/review-data.js');
  const all637 = sandbox.window.ALL_CHARACTERS_637;
  const high159 = sandbox.window.REVIEW_TARGETS_159;

  if (!Array.isArray(all637) || all637.length !== 637) {
    throw new Error(`Expected 637 characters in ALL_CHARACTERS_637, got ${all637 ? all637.length : 0}`);
  }
  if (!Array.isArray(high159) || high159.length !== 159) {
    throw new Error(`Expected 159 items in REVIEW_TARGETS_159, got ${high159 ? high159.length : 0}`);
  }
  console.log(`[PASS] Check 1 (Catalog): 637 total entries & 159 high-priority loaded.`);
} catch (e) {
  console.error('[FAIL] Check 1 error:', e.message);
  process.exit(1);
}

// -------------------------------------------------------------
// Check 2: strokes-bundle.js (637 all stroke bundle)
// -------------------------------------------------------------
try {
  runInSandbox('prototype/stroke-assist/js/strokes-bundle.js');
  const bundle = sandbox.window.STROKE_DATA_BUNDLE;
  const bundleChars = Object.keys(bundle).filter(k => k !== 'characters' && k !== 'metadata');
  if (bundleChars.length !== 637) {
    throw new Error(`Expected 637 characters in STROKE_DATA_BUNDLE, got ${bundleChars.length}`);
  }
  console.log(`[PASS] Check 2 (Bundle): 637 characters in STROKE_DATA_BUNDLE loaded.`);
} catch (e) {
  console.error('[FAIL] Check 2 error:', e.message);
  process.exit(1);
}

// -------------------------------------------------------------
// Check 3: sample-strokes.js (12 sample characters)
// -------------------------------------------------------------
try {
  runInSandbox('prototype/stroke-assist/js/sample-strokes.js');
  const samples = sandbox.window.SAMPLE_STROKES;
  const required = ['土', '士', '日', '曰', '木', '永', '學', '道', '馬', '國', '火', '九'];
  for (const k of required) {
    if (!samples[k]) throw new Error(`Missing sample: ${k}`);
  }
  console.log(`[PASS] Check 3 (Samples): 12 built-in sample characters loaded.`);
} catch (e) {
  console.error('[FAIL] Check 3 error:', e.message);
  process.exit(1);
}

// -------------------------------------------------------------
// Check 4: stroke-engine.js Unit Tests (Font & TopDown)
// -------------------------------------------------------------
try {
  runInSandbox('prototype/stroke-assist/js/stroke-engine.js');
  const Engine = sandbox.window.StrokeEngine;

  // 4.1 Font coordinate system (土)
  const tuSample = sandbox.window.SAMPLE_STROKES['土'];
  const med0SvgFont = Engine.convertMedianToSvg(tuSample.medians[0], false);
  const inputFont = med0SvgFont.map(p => ({ x: p.x, y: p.y }));
  const resFont = Engine.evaluateStroke(inputFont, tuSample.medians[0], Engine.PRESETS.normal, { character: '土', strokeIndex: 0, isTopDown: false });
  if (!resFont.pass) throw new Error(`Font-coord evaluation failed: ${resFont.feedback}`);

  // 4.2 TopDown coordinate system (from bundle 漢)
  const hanBundle = sandbox.window.STROKE_DATA_BUNDLE['漢'];
  const hanMed0Svg = Engine.convertMedianToSvg(hanBundle.medians[0], true);
  const inputTopDown = hanMed0Svg.map(p => ({ x: p.x, y: p.y }));
  const resTopDown = Engine.evaluateStroke(inputTopDown, hanBundle.medians[0], Engine.PRESETS.normal, { character: '漢', strokeIndex: 0, isTopDown: true });
  if (!resTopDown.pass) throw new Error(`TopDown-coord evaluation failed: ${resTopDown.feedback}`);

  // 4.3 Reversed direction rejection
  const reversedInput = [...inputFont].reverse();
  const resRev = Engine.evaluateStroke(reversedInput, tuSample.medians[0], Engine.PRESETS.normal, { character: '土', strokeIndex: 0 });
  if (resRev.pass) throw new Error(`Reversed stroke should fail`);

  // 4.4 Special Discrimination Tests: 土 vs 士 and 日 vs 曰
  // 土 top too wide -> FAIL
  const wideTopTu = [{ x: 150, y: 460 }, { x: 400, y: 450 }, { x: 850, y: 440 }];
  const resTuFail = Engine.evaluateStroke(wideTopTu, tuSample.medians[0], Engine.PRESETS.normal, { character: '土', strokeIndex: 0 });
  if (resTuFail.pass || resTuFail.reason !== 'special_char_rule') throw new Error(`土 wide top should fail special_char_rule`);

  // 士 top too short -> FAIL
  const shiSample = sandbox.window.SAMPLE_STROKES['士'];
  const shortTopShi = [{ x: 300, y: 460 }, { x: 500, y: 450 }, { x: 700, y: 440 }];
  const resShiFail = Engine.evaluateStroke(shortTopShi, shiSample.medians[0], Engine.PRESETS.normal, { character: '士', strokeIndex: 0 });
  if (resShiFail.pass || resShiFail.reason !== 'special_char_rule') throw new Error(`士 short top should fail special_char_rule`);

  // 日 stroke 1 drawn too wide -> FAIL
  const riBundle = sandbox.window.STROKE_DATA_BUNDLE['日'];
  const wideRi = [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 500 }];
  const resRiFail = Engine.evaluateStroke(wideRi, riBundle.medians[1], Engine.PRESETS.normal, { character: '日', strokeIndex: 1, isTopDown: true });
  if (resRiFail.pass || resRiFail.reason !== 'special_char_rule') throw new Error(`日 drawn wide should fail special_char_rule`);

  // 曰 stroke 1 drawn too tall -> FAIL
  const yueBundle = sandbox.window.STROKE_DATA_BUNDLE['曰'];
  const tallYue = [{ x: 300, y: 150 }, { x: 600, y: 150 }, { x: 600, y: 700 }];
  const resYueFail = Engine.evaluateStroke(tallYue, yueBundle.medians[1], Engine.PRESETS.normal, { character: '曰', strokeIndex: 1, isTopDown: true });
  if (resYueFail.pass || resYueFail.reason !== 'special_char_rule') throw new Error(`曰 drawn tall should fail special_char_rule`);

  console.log(`[PASS] Check 4 (Unit Tests): Font/TopDown, Reverse rejection, 土/士/日/曰 discrimination rules passed.`);
} catch (e) {
  console.error('[FAIL] Check 4 error:', e.message);
  process.exit(1);
}

// -------------------------------------------------------------
// Check 5: 637 Character All-Stroke Full Scan
// -------------------------------------------------------------
let totalStrokesGlobal = 0;
try {
  const Engine = sandbox.window.StrokeEngine;
  const bundle = sandbox.window.STROKE_DATA_BUNDLE;
  const catalog = sandbox.window.ALL_CHARACTERS_637;

  let passedStrokes = 0;

  for (const entry of catalog) {
    const ch = entry.character;
    const data = bundle[ch];
    if (!data) throw new Error(`Missing in bundle: ${ch}`);

    for (let sIdx = 0; sIdx < data.medians.length; sIdx++) {
      totalStrokesGlobal++;
      const median = data.medians[sIdx];
      const svgPts = Engine.convertMedianToSvg(median, !!data.isTopDown);
      const input = svgPts.map(p => ({ x: p.x, y: p.y }));

      const res = Engine.evaluateStroke(input, median, Engine.PRESETS.normal, {
        character: ch,
        strokeIndex: sIdx,
        totalStrokes: data.medians.length,
        isTopDown: !!data.isTopDown,
        renderMode: data.renderMode || 'fill'
      });

      if (res.pass) {
        passedStrokes++;
      } else {
        throw new Error(`Stroke failed for ${ch} #${sIdx + 1}: ${res.reason} - ${res.feedback}`);
      }
    }
  }

  console.log(`[PASS] Check 5 (637 Full Scan): All ${catalog.length} characters & all ${totalStrokesGlobal} strokes passed (100.00%)!`);
} catch (e) {
  console.error('[FAIL] Check 5 error:', e.message);
  process.exit(1);
}

// -------------------------------------------------------------
// Check 6: app.js Syntax Validation
// -------------------------------------------------------------
try {
  const appCode = fs.readFileSync('prototype/stroke-assist/js/app.js', 'utf-8');
  new vm.Script(appCode, { filename: 'app.js' });
  console.log(`[PASS] Check 6 (App Syntax): app.js syntax validated.`);
} catch (e) {
  console.error('[FAIL] Check 6 error:', e.message);
  process.exit(1);
}

console.log('\n================================================================');
console.log(`  ALL INTEGRATION TESTS PASSED 100% (637 Characters / ${totalStrokesGlobal} Strokes) `);
console.log('================================================================');
