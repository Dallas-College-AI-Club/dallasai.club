import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventInline,
  eventText,
  eventList,
  eventAgenda,
  eventPlainText,
} from '../lib/event-format.mjs';
test('event formatting preserves plain paragraphs and safely renders headings, emphasis and lists', () => {
  assert.equal(
    eventInline('<img src=x onerror=alert(1)> **Safe** *text*'),
    '&lt;img src=x onerror=alert(1)&gt; <strong>Safe</strong> <em>text</em>',
  );
  assert.equal(
    eventText(
      'First line\nSecond line\n\n## Bring along\n- **Ideas**\n- A notebook\n\n1. Start\n2. Share',
    ),
    '<p>First line<br>Second line</p><h3>Bring along</h3><ul><li><strong>Ideas</strong></li><li>A notebook</li></ul><ol><li>Start</li><li>Share</li></ol>',
  );
  assert.match(
    eventText('one\ntwo\nthree\nfour\n**five**'),
    /<strong>five<\/strong>/,
  );
  assert.equal(
    eventList(['- **One**', '2. Two']),
    '<ul><li><strong>One</strong></li><li>Two</li></ul>',
  );
  assert.doesNotMatch(
    eventText('<script>alert(1)</script>\n[jump](javascript:alert(1))'),
    /<script|<a|onclick/,
  );
});
test('timed agendas retain duration and description, and plain lines remain usable', () => {
  const result = eventAgenda([
    '20 minutes · 1. **Welcome** · Meet everyone',
    'Break',
    '<img src=x onerror=alert(1)>',
  ]);
  assert.match(result, />20 minutes<\/span>/);
  assert.match(result, /<strong>Welcome<\/strong>/);
  assert.match(result, /<p>Meet everyone<\/p>/);
  assert.match(result, />Break<\/strong>/);
  assert.doesNotMatch(result, /<img/);
});

test('event summaries remain plain text in search and news cards', () => {
  assert.equal(
    eventPlainText(
      '## Overview\n\n**Ideas** and *practice*\n- Bring questions',
    ),
    'Overview Ideas and practice Bring questions',
  );
});
