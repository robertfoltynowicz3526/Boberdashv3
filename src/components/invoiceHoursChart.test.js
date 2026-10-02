import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceHoursChartHtml } from './invoiceHoursChart.js';

test('renders exactly three proportional horizontal rows with visible values', () => {
  const html = buildInvoiceHoursChartHtml({
    labels: ['07.26', '08.26', '09.26'],
    values: [102.5, 97, 83.5],
    deltaPct: -14
  });

  assert.equal((html.match(/class="fh3m-row"/g) || []).length, 3);
  assert.match(html, /width:100%;/);
  assert.match(html, /width:94\.6341463414634%;/);
  assert.match(html, /width:81\.46\d*%;/);
  assert.match(html, />102\.5 h</);
  assert.match(html, />97\.0 h</);
  assert.match(html, />83\.5 h</);
  assert.match(html, /delta down">↓ -14%/);
});

test('uses positive and neutral trend presentations without changing the percentage', () => {
  const positive = buildInvoiceHoursChartHtml({ labels: ['1', '2', '3'], values: [1, 2, 3], deltaPct: 50 });
  const neutral = buildInvoiceHoursChartHtml({ labels: ['1', '2', '3'], values: [0, 0, 0], deltaPct: 0 });

  assert.match(positive, /delta up">↑ \+50%/);
  assert.match(neutral, /delta neutral">0%/);
  assert.equal((neutral.match(/width:0%;/g) || []).length, 3);
});
