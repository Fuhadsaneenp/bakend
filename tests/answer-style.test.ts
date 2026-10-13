import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directSummary, wantsDetailedAnswer, directAnswerRules } from '../src/modules/ai/answer-style.ts';
test('direct questions do not request report wrappers', () => {
  for (const q of ['Who recorded the most data entries?', 'How many jobs did Safna publish?', 'ഏറ്റവും കൂടുതൽ ഡാറ്റാ എൻട്രി ചെയ്തത് ആരാണ്?', 'What about yesterday?']) assert.equal(wantsDetailedAnswer(q), false);
  assert.equal(wantsDetailedAnswer('Give a detailed breakdown'), true);
  assert.equal(wantsDetailedAnswer('വിശദമായ റിപ്പോർട്ട് തരൂ'), true);
});
test('short answers extract the result without unrelated report sections', () => {
  assert.equal(directSummary('### **Workload Report**\n\n**Summary:**\n**Person** — **73 entries**.\n\n**Detailed Report:**\nUnrelated list'), '**Person** — **73 entries**.');
  assert.equal(directSummary('No records found.'), 'No records found.');
  assert.match(directAnswerRules, /Name every tied winner/);
  assert.match(directAnswerRules, /never reuse example numbers/);
});
