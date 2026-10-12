import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPrintPages, printPaperPoints, visibleLegend, printedEventCount, DEFAULT_TEAMUP_PRINT } from '../src/teamupPrint.ts';
import { emptyTranslationStore, approveTranslation, findApprovedTranslation, translationHints, addTerm, importTranslationData, exportTranslationData, parseTranslationStore } from '../src/translationMemory.ts';

const day = date => ({date,events:[{id:date,title:'Work at Site',start:8*60,end:12*60,categories:['Outside'],subcalendarIds:[7,8]}]});
test('day/week/month print grouping never filters events due to sidebar selections', () => {
  const days=[day('2026-10-08'),day('2026-10-09'),day('2026-10-12')];
  for(const view of ['day','week','month']){
    const groups=groupPrintPages(days,view);
    assert.equal(groups.reduce((n,g)=>n+printedEventCount(g.days),0),3);
  }
  assert.equal(visibleLegend([{id:7,name:'A'},{id:8,name:'B'}],{...DEFAULT_TEAMUP_PRINT,showLegend:true,legendIds:[7]}).length,1);
  assert.equal(printedEventCount([day('2026-10-08')]),1);
});
test('paper size and orientation match ISO sizes',()=>{
  assert.deepEqual(printPaperPoints({...DEFAULT_TEAMUP_PRINT,paper:'A4',orientation:'portrait'}),[595.28,841.89]);
  assert.deepEqual(printPaperPoints({...DEFAULT_TEAMUP_PRINT,paper:'A4',orientation:'landscape'}),[841.89,595.28]);
});
test('approved Thai translation wins over AI when input is repeated',()=>{
  const initial=emptyTranslationStore();
  const saved=approveTranslation(initial,'ไปหน้างาน งานวัดไทร ประกอบงานโครงสร้าง','Site Visit – Wat Sai Project – Structural Assembly Work');
  assert.equal(findApprovedTranslation(saved,'  ไปหน้างาน งานวัดไทร ประกอบงานโครงสร้าง '),'Site Visit – Wat Sai Project – Structural Assembly Work');
  assert.equal(initial.entries.length,0);
});
test('private custom term overrides built-in terminology and relevant hints',()=>{
  const a=addTerm(emptyTranslationStore(),'งานวัดไทร','Wat Sai Temple Construction Project');
  const hints=translationHints(a,'ไปหน้างาน งานวัดไทร ประกอบงานโครงสร้าง');
  assert.equal(hints.terms.find(x=>x.thai==='งานวัดไทร').english,'Wat Sai Temple Construction Project');
});
test('CSV/JSON import accepts reviewed terms without using external unapproved content',()=>{
  const out=importTranslationData(emptyTranslationStore(),'thai,english\nเสาเอ็น,Tie Column\nคานทับหลัง,Lintel Beam','terms.csv');
  assert.equal(out.store.terms.length,2);
  const saved=exportTranslationData(out.store);
  assert.equal(parseTranslationStore(saved).terms.length,2);
});
