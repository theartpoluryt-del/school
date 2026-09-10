const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');

function printStyles() {
  const start=css.indexOf('@media print');
  assert(start>=0);
  const opening=css.indexOf('{',start);
  let depth=1, end=opening+1;
  for (;end<css.length && depth;end++) {
    if(css[end]==='{') depth++;
    if(css[end]==='}') depth--;
  }
  return css.slice(opening+1,end-1);
}

function declarationsFor(selector) {
  return [...printStyles().matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match=>match[1].replace(/\/\*[\s\S]*?\*\//g,'').split(',').some(s=>s.trim()===selector))
    .map(match=>match[2]).join('\n');
}

test('printed lesson cells contain only their grade/dot, without hours, roster or appendix',()=>{
  for (const selector of ['.print-lesson-details','.print-roster-report','.person-hours-note',
    '.journal-roster-details','.journal-roster-label','.grade-control .grade-select']) {
    const displays=[...declarationsFor(selector).matchAll(/display:\s*([^;]+);/g)].map(m=>m[1].trim());
    assert.equal(displays.at(-1),'none',selector+' must remain hidden in print');
  }
  assert(!/display:\s*none/.test(declarationsFor('.grade-control')));
  assert(!/display:\s*none/.test(declarationsFor('.grade-value')));
  assert(/min-height:\s*12px/.test(declarationsFor('.grade-control')));
  assert(/font-size:\s*10px/.test(declarationsFor('.grade-control')));
});
