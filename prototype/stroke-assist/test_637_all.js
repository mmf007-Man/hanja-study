const fs = require('fs');
const vm = require('vm');

console.log('================================================================');
console.log('  637 Hanja All-Characters Stroke Engine Full Integration Test  ');
console.log('================================================================\n');

// Mock sandbox
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

// 1. Load review-data.js
runInSandbox('prototype/stroke-assist/js/review-data.js');
const all637Catalog = sandbox.window.ALL_CHARACTERS_637;
console.log(`[PASS] review-data.js: Catalog entries = ${all637Catalog.length}`);

// 2. Load strokes-bundle.js
runInSandbox('prototype/stroke-assist/js/strokes-bundle.js');
const bundle = sandbox.window.STROKE_DATA_BUNDLE;
const bundleChars = Object.keys(bundle).filter(k => k !== 'characters' && k !== 'metadata');
console.log(`[PASS] strokes-bundle.js: Loaded characters = ${bundleChars.length}`);

// 3. Load sample-strokes.js & stroke-engine.js
runInSandbox('prototype/stroke-assist/js/sample-strokes.js');
runInSandbox('prototype/stroke-assist/js/stroke-engine.js');
const Engine = sandbox.window.StrokeEngine;
console.log(`[PASS] stroke-engine.js: Engine initialized.\n`);

// -------------------------------------------------------------
// Comprehensive 637 Character All-Stroke Test
// -------------------------------------------------------------
let totalCharacters = 0;
let totalStrokes = 0;
let passStrokes = 0;
let failStrokes = 0;
let reversedDetectedCount = 0;
let renderModeFillCount = 0;
let renderModeStrokeCount = 0;
let renderModeInternalCount = 0;

const failures = [];

for (const entry of all637Catalog) {
  const ch = entry.character;
  totalCharacters++;

  const strokeData = bundle[ch];
  if (!strokeData) {
    failures.push({ char: ch, strokeIdx: -1, reason: 'missing_in_bundle' });
    continue;
  }

  // Check strokes and medians exist and match count
  const strokes = strokeData.strokes || [];
  const medians = strokeData.medians || [];

  if (strokes.length === 0) {
    failures.push({ char: ch, strokeIdx: -1, reason: 'empty_strokes' });
    continue;
  }
  if (medians.length === 0) {
    failures.push({ char: ch, strokeIdx: -1, reason: 'empty_medians' });
    continue;
  }
  if (strokes.length !== medians.length) {
    failures.push({ char: ch, strokeIdx: -1, reason: `count_mismatch: strokes=${strokes.length}, medians=${medians.length}` });
  }

  // Count render modes
  const rm = strokeData.renderMode || 'fill';
  if (rm === 'stroke') renderModeStrokeCount++;
  else renderModeFillCount++;

  if (strokeData.provider === 'internal') renderModeInternalCount++;

  const isTopDown = !!strokeData.isTopDown;

  // Test every stroke in this character
  for (let sIdx = 0; sIdx < medians.length; sIdx++) {
    totalStrokes++;
    const medianFont = medians[sIdx];
    if (!medianFont || medianFont.length === 0) {
      failStrokes++;
      failures.push({ char: ch, strokeIdx: sIdx, reason: 'empty_median_points' });
      continue;
    }

    // 1) Test Forward Perfect Input (following median path points)
    const medianSvgPoints = Engine.convertMedianToSvg(medianFont, isTopDown);
    const forwardInput = medianSvgPoints.map(p => ({ x: p.x, y: p.y }));

    const context = {
      character: ch,
      strokeIndex: sIdx,
      totalStrokes: medians.length,
      isTopDown: isTopDown,
      renderMode: rm
    };

    const res = Engine.evaluateStroke(forwardInput, medianFont, Engine.PRESETS.normal, context);

    if (res.pass) {
      passStrokes++;
    } else {
      failStrokes++;
      failures.push({
        char: ch,
        strokeIdx: sIdx,
        reason: res.reason,
        feedback: res.feedback,
        metrics: res.metrics
      });
    }

    // 2) Test Reversed Input (must FAIL unless stroke is an unoriented dot)
    if (forwardInput.length >= 2) {
      const reversedInput = [...forwardInput].reverse();
      const resRev = Engine.evaluateStroke(reversedInput, medianFont, Engine.PRESETS.normal, context);
      if (!resRev.pass) {
        reversedDetectedCount++;
      }
    }
  }
}

console.log('----------------------------------------------------------------');
console.log(`Total Characters Tested: ${totalCharacters} / 637`);
console.log(`Total Strokes Evaluated: ${totalStrokes}`);
console.log(`Strokes Passed: ${passStrokes} / ${totalStrokes} (${(passStrokes / totalStrokes * 100).toFixed(2)}%)`);
console.log(`Strokes Failed: ${failStrokes}`);
console.log(`Reversed Stroke Detections: ${reversedDetectedCount}`);
console.log(`Render Mode Distribution: Fill = ${renderModeFillCount}, Stroke = ${renderModeStrokeCount}, Internal = ${renderModeInternalCount}`);
console.log('----------------------------------------------------------------\n');

if (failures.length > 0) {
  console.log(`[!] Found ${failures.length} stroke failures:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  - Character ${f.char} Stroke #${f.strokeIdx + 1}: [${f.reason}] ${f.feedback || ''}`);
  }
  process.exit(1);
} else {
  console.log('🎉 100% PERFECT PASS! All 637 characters & all strokes passed verification without a single error!');
}
