import { expect, test } from 'bun:test';
import { readableBody } from '#backend/services/syncs/sources/gmail/content.ts';

test('email HTML retains amounts, data tables and useful links while stripping decoration, hidden text and tracking images', () => {
  const result = readableBody({
    html: '<style>bad</style><script>bad()</script><div style="display:none">Hidden preview</div><h1>Invoice</h1><table><tr><th>Item</th><th>Total</th></tr><tr><td>Services</td><td>£120.50</td></tr></table><a href="https://example.com/invoice">View invoice</a><img src="https://tracker.invalid/pixel"><a href="javascript:bad()">Unsafe link</a>',
    plain: '',
    attachments: [],
    previous: [],
  });
  expect(result.body).toContain('### Invoice');
  expect(result.body).toContain('Services');
  expect(result.body).toContain('£120.50');
  expect(result.body).toContain('[View invoice](https://example.com/invoice)');
  expect(result.body).not.toMatch(/tracker|Hidden preview|javascript|bad\(/);
});

test('HTML quote removal preserves new answers inside and outside quoted containers', () => {
  const result = readableBody({
    html: '<p>Answers below.</p><div class="gmail_quote"><div class="gmail_attr">On Nov 1 Alex wrote:</div><blockquote><p>Amount due: £120.50</p><p>I paid it today.</p><p>When can we meet?</p><p>Tuesday works.</p></blockquote></div><p>Regards, Sam</p>',
    plain: '',
    attachments: [],
    previous: ['Amount due: £120.50\nWhen can we meet?'],
  });
  expect(result.body).toContain('I paid it today.');
  expect(result.body).toContain('Tuesday works.');
  expect(result.body).not.toContain('Regards, Sam');
  expect(result.body).not.toContain('Amount due');
  expect(result.body).not.toContain('When can we meet');
});

test('line-broken HTML quotes keep inline answers and remove earlier messages', () => {
  const result = readableBody({
    html: '<div class="gmail_quote">Amount due: £120.50<br>Paid today.<br>When can we meet?</div>',
    plain: '',
    attachments: [],
    previous: ['Amount due: £120.50\nWhen can we meet?'],
  });
  expect(result.body).toContain('Paid today.');
  expect(result.body).not.toContain('Amount due');
  expect(result.body).not.toContain('When can we meet');
});

test('plain text remains available when the HTML alternative contains only decoration', () => {
  const result = readableBody({
    html: '<img src="https://example.invalid/pixel">',
    plain: 'Your total is £42.',
    attachments: [],
    previous: [],
  });
  expect(result.body).toBe('Your total is £42.');
});

test('plain-text replies keep inline answers while removing signatures and repeated quotes', () => {
  const result = readableBody({
    html: '',
    plain:
      'Answers below.\n\nOn Nov 1, Alex wrote:\n> R&D budget < £20?\n\nFirst answer.\n\n> Second question?\n\nSecond answer.\n\nRegards,\nSam',
    attachments: [],
    previous: ['R&D budget < £20?\nSecond question?'],
  });
  expect(result.body).toContain('First answer.');
  expect(result.body).toContain('Second answer.');
  expect(result.body).not.toContain('Sam');
  expect(result.body).not.toContain('budget');
  expect(result.body).not.toContain('Alex wrote');
});

test('inline image references point to stored assets and retain a readable body', () => {
  const result = readableBody({
    html: '<p>See the chart.</p><img src="cid:chart" alt="Revenue">',
    plain: '',
    attachments: [{ name: 'chart.png', contentId: 'chart', file: 'open-sync-asset:chart' }],
    previous: [],
  });
  expect(result.body).toContain('![Revenue](open-sync-asset:chart)');
});

test('fresh quotations in an initial message retain information absent from the conversation', () => {
  const result = readableBody({
    html: '',
    plain: 'An external quote:\n> Revenue: £123,000\n> Expenses: £48,000',
    attachments: [],
    previous: [],
  });
  expect(result.body).toContain('Revenue: £123,000');
  expect(result.body).toContain('Expenses: £48,000');
});

test('quoted HTML tables already rendered in a previous message do not repeat', () => {
  const html =
    '<table><tr><th>Item</th><th>Total</th></tr><tr><td>Services</td><td>£120.50</td></tr></table>';
  const original = readableBody({ html, plain: '', attachments: [], previous: [] });
  const reply = readableBody({
    html: `<p>Paid.</p><blockquote>${html}</blockquote>`,
    plain: '',
    attachments: [],
    previous: [original.original],
  });
  expect(reply.body).toContain('Paid.');
  expect(reply.body).not.toContain('£120.50');
});

test('short inline answers are not confused with substrings of older words', () => {
  const result = readableBody({
    html: '<p>Answers below.</p><blockquote><p>Was the invoice sent yesterday?</p><p>yes</p></blockquote>',
    plain: '',
    attachments: [],
    previous: ['Was the invoice sent yesterday?'],
  });
  expect(result.body).toContain('yes');
  expect(result.body).not.toContain('yesterday');
});

test('presentation tables lose their layout while nested data tables retain amounts', () => {
  const result = readableBody({
    html: '<table role="presentation"><tr><td><h1>Invoice</h1><table><tr><th>Item</th><th>Total</th></tr><tr><td>Services</td><td>£120.50</td></tr></table></td></tr></table>',
    plain: '',
    attachments: [],
    previous: [],
  });
  expect(result.body).toStartWith('### Invoice');
  expect(result.body.match(/^\|(?:\s*-+\s*\|)+$/gm)).toHaveLength(1);
  expect(result.body).toContain('£120.50');
});

test('new quoted headings keep their meaning alongside information from outside the conversation', () => {
  const result = readableBody({
    html: '',
    plain: 'Additional figures:\n> New budget:\n> Revenue: £123,000',
    attachments: [],
    previous: ['What is the new budget?'],
  });
  expect(result.body).toContain('New budget:');
  expect(result.body).toContain('Revenue: £123,000');
});

test('unmarked newsletter layout tables read as paragraphs, including their nested content', () => {
  const result = readableBody({
    html: '<table><tr><td>&nbsp;</td><td><table><tr><td><p>Your contract expires in 28 days.</p><p><a href="https://example.com/details">Review details</a></p></td></tr></table></td><td>&nbsp;</td></tr></table>',
    plain: '',
    attachments: [],
    previous: [],
  });
  expect(result.body).toBe(
    'Your contract expires in 28 days.\n\n[Review details](https://example.com/details)',
  );
});

test('an embedded Outlook envelope becomes a short attribution above the forwarded text', () => {
  const result = readableBody({
    html: '<p>Buona giornata!</p><p><b>Da:</b> Office<br><b>Inviato:</b> martedì alle 09:43<br><b>A:</b> Team<br><b>Oggetto:</b> Fattura</p><p>In allegato la fattura.</p>',
    plain: '',
    attachments: [],
    previous: [],
  });
  expect(result.body).toContain('Buona giornata!');
  expect(result.body).toContain('Forwarded from Office');
  expect(result.body).toContain('Fattura');
  expect(result.body).toContain('In allegato la fattura.');
  expect(result.body).not.toContain('Inviato:');
});

test('a delimited signature can precede a postscript or a forwarded email', () => {
  const result = readableBody({
    plain:
      'See invoice.\r\n-- \r\nAlex\r\nBilling Department\r\nP.S. Total is £240.\r\n\r\nFrom: Accounts\r\nThe invoice is attached.\r\nSent from my iPhone',
    html: '',
    attachments: [],
    previous: [],
  });
  expect(result.body).toContain('See invoice.');
  expect(result.body).toContain('P.S. Total is £240.');
  expect(result.body).toContain('The invoice is attached.');
  expect(result.body).not.toMatch(/Alex|Billing Department|Sent from my iPhone/);
});

test('the plain alternative supplies missing content without bringing back an HTML signature', () => {
  const input = {
    html: '<div class="gmail_signature">Alex Accounts</div>',
    previous: [],
    attachments: [],
  };
  expect(readableBody({ ...input, plain: 'Alex Accounts' }).body).toBe('');
  expect(readableBody({ ...input, plain: 'Account balance: £42.' }).body).toBe(
    'Account balance: £42.',
  );
});
