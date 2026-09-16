const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
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

test('three separate print buttons isolate the matrix, topics and monthly hours',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  assert(html.includes('id="printJournal"'));
  assert(!html.includes('id="printJournalTopics"'));
  assert(!html.includes('id="printJournalMonthly"'));
  for(const [section,id,mode] of [['journal-topics-section','printJournalTopics','topics'],['journal-monthly-section','printJournalMonthly','monthly']]) {
    const header=source.slice(source.indexOf(`journal-detail-section ${section}`)).split('</div>')[0];
    assert(header.includes(`id="${id}"`));
    assert(header.includes(`data-journal-print-section="${mode}"`));
    assert(header.includes('no-print'));
  }
  assert(source.includes("document.querySelector('#journalDetails').addEventListener('click'"));
  for(const selector of [
    'body[data-journal-print="matrix"] #journalDetails',
    'body[data-journal-print="topics"] #journalMatrix',
    'body[data-journal-print="topics"] .journal-monthly-section',
    'body[data-journal-print="monthly"] #journalMatrix',
    'body[data-journal-print="monthly"] .journal-topics-section',
    'body[data-journal-print] #absencePanel'
  ]) assert.match(declarationsFor(selector),/display:\s*none\s*!important/);
  assert.match(declarationsFor('body[data-journal-print] .journal-detail-section'),/break-before:\s*auto/);
});

test('each print mode waits for saved data and clears incompatible print modes',async()=>{
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const start=source.indexOf('async function printJournalSection('),end=source.indexOf('\nfunction ',start);
  let saved=true,prints=0,cleared=[];
  const body={dataset:{},classList:{remove:(...names)=>{cleared=names;}}};
  const c=vm.createContext({document:{body},window:{print:()=>prints++},ensureCloudSaved:async()=>saved});
  vm.runInContext(source.slice(start,end),c);
  for(const mode of ['matrix','topics','monthly']) {
    await c.printJournalSection(mode);assert.equal(body.dataset.journalPrint,mode);
    assert.deepEqual(cleared,['printing-schedule','printing-substitutions']);
  }
  assert.equal(prints,3);
  saved=false;await c.printJournalSection('matrix');assert.equal(prints,3);
  saved=true;await c.printJournalSection('unknown');assert.equal(prints,3);
  assert.match(source,/afterprint[^\n]+delete document\.body\.dataset\.journalPrint/);
});
