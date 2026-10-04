// Disposable local fixtures only. Run after npm run build.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { officeFixture } from './helpers/office-fixture.mjs';
import { builderSample } from './helpers/survey-response-samples.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import { saveEvent } from '../lib/events.mjs';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const failures = [];

async function seed(fixture, many) {
  const { db, event } = fixture;
  const alex = fixture.entries.find((entry) => entry.kind === 'rsvp');
  await db.query('UPDATE club_forms.entries SET name=$2 WHERE id=$1', [
    alex.id,
    'Alex Sample',
  ]);
  const other = await saveEvent(
    db,
    {
      id: 'other-group-event',
      revision: 0,
      action: 'publish',
      event: { ...event.draft, title: 'Other group event', date: '2030-10-05' },
    },
    'officer@example.com',
  );
  async function rsvp(name, email, target = event, older = false) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data,created_at)
       VALUES($1::uuid,'rsvp',$2,$3,$1::text,$4,CASE WHEN $5 THEN now()-interval '365 days' ELSE now() END)`,
      [
        id,
        email,
        name,
        JSON.stringify({
          eventId: target.id,
          eventTitle: target.draft.title,
          eventDate: target.draft.date,
          hasSurvey: true,
        }),
        older,
      ],
    );
    await db.query(
      `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,event_date,survey_version,questions,answers,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8 THEN now()-interval '365 days' ELSE now() END)`,
      [
        id,
        target.id,
        target.draft.title,
        target.draft.date,
        target.published.surveyVersion,
        JSON.stringify(target.draft.surveyQuestions),
        JSON.stringify([
          {
            questionId: target.draft.surveyQuestions[0].id,
            value: 'Evening',
            other: '',
          },
        ]),
        older,
      ],
    );
    return id;
  }
  const jordan = await rsvp('Jordan Sample', 'jordan@example.edu');
  await rsvp('Alex Other Event', alex.email, other);
  if (many)
    for (let n = 0; n < 50; n++)
      await rsvp('Page Person ' + n, `page-${n}@example.edu`, event, true);
  for (const [name, status] of [
    ['Reviewed question', 'reviewed'],
    ['Archived question', 'closed'],
  ])
    await db.query(
      `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data,review_status) VALUES($1::uuid,'question',$2,$3,$1::text,'{"message":"Synthetic status check"}',$4)`,
      [
        randomUUID(),
        name.split(' ')[0].toLowerCase() + '@example.edu',
        name,
        status,
      ],
    );
  await db.query(
    "INSERT INTO club_forms.audit(actor,action) VALUES('officer@example.com','submission-permanently-deleted')",
  );
  const surveys = [];
  for (const title of ['Office feedback A', 'Office feedback B']) {
    const id = randomUUID(),
      sample = builderSample();
    for (const [action, expectedRevision] of [
      ['save', 0],
      ['publish', 1],
    ])
      await changeDraft(
        db,
        { email: 'officer@example.com' },
        {
          id,
          definition: { ...sample.definition, title, eventId: event.id },
          action,
          expectedRevision,
          requestId: randomUUID(),
        },
      );
    const people = [['jordan', 'Jordan Sample', 'jordan@example.edu', true]];
    if (many && title.endsWith('A'))
      for (let n = 0; n < 11; n++)
        people.push([
          `feedback-${n}`,
          `Feedback Person ${n}`,
          `feedback-${n}@example.edu`,
          true,
        ]);
    if (title.endsWith('A'))
      people.push([
        'archived',
        'Archived feedback',
        'archived-feedback@example.edu',
        false,
      ]);
    for (const [advisor, name, email, active] of people) {
      await db.query(
        'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$3,$4,$5)',
        [id, advisor, name, email, active],
      );
      await db.query(
        'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
        [id, advisor, JSON.stringify(sample.answers(title + ' answer'))],
      );
    }
    surveys.push(id);
  }
  return { alex: alex.id, jordan, event: event.id, other: other.id, surveys };
}

async function check(name, run, { many = false } = {}) {
  const fixture = await officeFixture();
  let context;
  try {
    const ids = await seed(fixture, many);
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(fixture.origin + '/test-signin');
    await expect(page.locator('#office')).toBeVisible();
    await run(page, fixture, ids);
    assert.deepEqual(errors, []);
    console.log('PASS ' + name);
  } catch (error) {
    failures.push(name + ': ' + error.stack);
    console.error('FAIL ' + name + ': ' + error.message);
  } finally {
    await context?.close();
    await fixture.close();
  }
}
async function inline(page) {
  await page.locator('#surveys-tab').click();
  await page.locator('#survey-title-search').fill('Office feedback A');
  const row = page.locator(
    '#survey-library .survey-library-section > details.survey-library-row',
  );
  await expect(row).toHaveCount(1);
  await row.locator(':scope > summary').click();
  const host = row.locator('.inline-event-surveys');
  await expect(host.locator('.survey-response')).not.toHaveCount(0);
  return host;
}
async function events(page, fixture, id) {
  await page.goto(fixture.origin + '/admin/#/surveys/events?event=' + id);
  const root = page.locator('#event-surveys-root');
  await expect(root.locator('.survey-event-group')).toHaveCount(1);
  return root;
}
async function csv(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  return readFile(await (await pending).path(), 'utf8');
}

try {
  await check(
    'Inline cards separate RSVP and feedback, expand later pages, and refresh attendance',
    async (page, fixture, ids) => {
      const host = await inline(page);
      const sections = host.locator('.survey-response-kind');
      await expect(sections).toHaveCount(2);
      await expect(sections.nth(0).locator(':scope > summary')).toContainText(
        'RSVP',
      );
      await expect(sections.nth(1).locator(':scope > summary')).toHaveText(
        'Event feedback',
      );
      await expect(host.locator('.survey-response')).toHaveCount(50);
      await host
        .getByRole('button', { name: 'Expand all answers', exact: true })
        .click();
      await expect(host.locator('.survey-response[open]')).toHaveCount(50);
      await expect(host.locator('.response-person[open]')).toHaveCount(10);
      await expect(
        sections.nth(1).locator('.survey-participation'),
      ).toHaveCount(0);
      await host.locator('[data-survey-ref="survey-next"]').click();
      await expect(host.locator('.survey-response[open]')).toHaveCount(52);
      await sections
        .nth(1)
        .getByRole('button', { name: 'Load more responses', exact: true })
        .click();
      await expect(host.locator('.response-person[open]')).toHaveCount(12);
      await host
        .getByRole('button', { name: 'Collapse all answers', exact: true })
        .click();
      await expect(host.locator('.survey-response[open]')).toHaveCount(0);
      await expect(host.locator('.response-person[open]')).toHaveCount(0);
      await expect(host.locator('.custom-survey-group[open]')).toHaveCount(0);
      await host
        .getByRole('button', { name: 'Expand all answers', exact: true })
        .click();
      await expect(host.locator('.survey-response[open]')).toHaveCount(52);
      await expect(host.locator('.response-person[open]')).toHaveCount(12);
      const alex = host.locator(`[data-entry-id="${ids.alex}"]`);
      await alex
        .getByLabel('Attendance for Alex Sample', { exact: true })
        .selectOption('attended');
      await expect(host.locator('.survey-response')).toHaveCount(52);
      await expect(
        alex.getByLabel('Attendance for Alex Sample', { exact: true }),
      ).toHaveValue('attended');
      await expect(alex.locator('.survey-participation')).toContainText(
        'Attended',
      );
      await expect(
        alex.getByRole('button', { name: 'Edit response', exact: true }),
      ).toBeVisible();
      await expect(
        alex.getByRole('button', { name: 'Contact history', exact: true }),
      ).toBeVisible();
      await page.reload();
      const reloaded = await inline(page);
      await expect(
        reloaded.locator(`[data-entry-id="${ids.alex}"] .survey-participation`),
      ).toContainText('Attended');
    },
    { many: true },
  );

  await check(
    'Event summaries and CSV distinguish sources and archive filtering',
    async (page, fixture, ids) => {
      const root = await events(page, fixture, ids.event);
      await root
        .getByRole('button', { name: 'Compile event summary', exact: true })
        .click();
      const report = page.getByRole('dialog', {
        name: 'Compiled answers',
        exact: true,
      });
      await expect(report.locator('.survey-summary-group')).toHaveCount(3);
      await expect(
        report
          .locator('.survey-summary-group > summary')
          .filter({ hasText: ' · RSVP · ' }),
      ).toHaveCount(1);
      await expect(report).toContainText('Event feedback: Office feedback A');
      await expect(report).toContainText('Event feedback: Office feedback B');
      const exported = await csv(
        page,
        report.getByRole('button', { name: 'Export CSV', exact: true }),
      );
      for (const text of [
        'Alex Sample',
        'Jordan Sample',
        'Office feedback A',
        'Office feedback B',
      ])
        assert.ok(exported.includes(text), text);
      assert.ok(!exported.includes('Alex Other Event'));
      assert.ok(!exported.includes('Archived feedback'));
      await report.getByRole('button', { name: 'Close', exact: true }).click();
      await root
        .getByRole('combobox', { name: /^Response type/ })
        .selectOption('feedback');
      await root.locator('#survey-view').selectOption('archived');
      await root
        .getByRole('button', { name: 'Expand all answers', exact: true })
        .click();
      await expect(root.locator('.response-person')).toHaveCount(1);
      await expect(root.locator('.response-person')).toContainText(
        'Archived feedback',
      );
      await expect(root.locator('.response-person')).not.toContainText(
        'Jordan Sample',
      );
    },
  );

  await check(
    'RSVP follow-up and legacy actions preserve event identity and filter scope',
    async (page, fixture, ids) => {
      const host = await inline(page);
      await host
        .getByRole('button', {
          name: 'Filter RSVPs for follow-up →',
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`event=${ids.event}&followup=1$`),
      );
      const root = page.locator('#event-surveys-root');
      await expect(
        root.getByRole('combobox', { name: /^Response type/ }),
      ).toHaveValue('rsvp');
      await root
        .getByRole('combobox', { name: /^Feedback status/ })
        .selectOption('missing');
      await expect(root.locator('.survey-response')).toHaveCount(1);
      const alex = root.locator(`[data-entry-id="${ids.alex}"]`);
      if ((await alex.getAttribute('open')) === null)
        await alex.locator(':scope > summary').click();
      await alex
        .getByLabel('Attendance for Alex Sample', { exact: true })
        .selectOption('attended');
      await root
        .locator('.survey-followup')
        .getByRole('combobox', { name: /^Attendance/ })
        .selectOption('not_recorded');
      await expect(root.locator('.survey-response')).toHaveCount(0);
      await root
        .locator('.survey-followup')
        .getByRole('combobox', { name: /^Attendance/ })
        .selectOption('attended');
      await expect(root.locator('.survey-response')).toHaveCount(1);
      await root
        .getByRole('combobox', { name: /^Response type/ })
        .selectOption('all');
      await expect(
        root
          .locator('.survey-followup')
          .getByRole('combobox', { name: /^Attendance/ }),
      ).toHaveValue('all');
      await expect(
        root.getByRole('combobox', { name: /^Feedback status/ }),
      ).toHaveValue('all');
      await expect(root.locator('.survey-response')).toHaveCount(2);
      if ((await alex.getAttribute('open')) === null)
        await alex.locator(':scope > summary').click();
      await alex.getByRole('button', { name: '☆ Star', exact: true }).click();
      await expect(
        alex.getByRole('button', { name: '★ Unstar', exact: true }),
      ).toBeVisible();
      await alex.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(alex).toHaveCount(0);
      await root.locator('#survey-view').selectOption('archived');
      await expect(alex).toHaveCount(1);
      if ((await alex.getAttribute('open')) === null)
        await alex.locator(':scope > summary').click();
      await alex.getByRole('button', { name: 'Restore', exact: true }).click();
      await expect(alex).toHaveCount(0);
      await root.locator('#survey-view').selectOption('active');
      await root.locator('#survey-event').selectOption(ids.other);
      await expect(root.locator('.survey-response')).toHaveCount(1);
      await expect(root.locator('.survey-participation')).toContainText(
        'Not recorded',
      );
      await expect(root.locator('.survey-participation')).toContainText(
        'No survey',
      );
    },
  );

  await check(
    'Home totals and default Inbox show only active submissions',
    async (page, fixture) => {
      await expect(
        page.locator('[data-inbox-status="active"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#entries')).not.toContainText(
        'Archived question',
      );
      await expect(page.locator('#entries')).toContainText('Reviewed question');
      await page.locator('#home-tab').click();
      const totals = page.locator('#home-tiles .tile').filter({
        has: page.getByRole('heading', { name: 'Inbox totals', exact: true }),
      });
      const expected = (
        await fixture.db.query(
          "SELECT count(*)::int AS n FROM club_forms.entries WHERE review_status IN ('new','reviewed')",
        )
      ).rows[0].n;
      await expect(totals.locator('.tile-number')).toHaveText(
        expected + ' active submissions',
      );
      await expect(totals).not.toContainText('permanently deleted');
      await expect(totals).not.toContainText('saved (including');
      const question = totals
        .getByRole('link')
        .filter({ hasText: 'Questions' });
      await expect(question.locator('strong')).toHaveText('2');
      await question.click();
      await expect(
        page.locator('[data-inbox-status="active"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#entries')).toContainText('Reviewed question');
      await expect(page.locator('#entries')).not.toContainText(
        'Archived question',
      );
      await page.locator('[data-inbox-status="closed"]').click();
      await expect(page.locator('#entries')).toContainText('Archived question');
    },
  );

  await check(
    'Inbox status actions retain matching Active and All cards and remove New-only matches',
    async (page, fixture, ids) => {
      await page.goto(
        fixture.origin + '/admin/#/inbox?type=rsvp-all&event=' + ids.event,
      );
      const alex = page.locator('#entry-' + ids.alex);
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await alex.locator(':scope > summary').click();
      await alex
        .getByRole('button', { name: 'Mark reviewed', exact: true })
        .click();
      await expect(alex.locator('.badge.reviewed')).toBeVisible();
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await expect(page.locator('.inbox-group > summary')).toHaveText(
        'Office audit event · 2 RSVPs',
      );
      await alex.getByRole('button', { name: 'Mark new', exact: true }).click();
      await expect(alex.locator('.badge.new')).toBeVisible();
      await alex
        .getByRole('button', { name: 'Archive submission', exact: true })
        .click();
      await expect(alex).toHaveCount(0);
      await expect(page.locator('.inbox-group > summary')).toHaveText(
        'Office audit event · 1 RSVP',
      );
      await page.locator('[data-inbox-status=""]').click();
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await alex.locator(':scope > summary').click();
      await alex.getByRole('button', { name: 'Mark new', exact: true }).click();
      await expect(alex.locator('.badge.new')).toBeVisible();
      await alex
        .getByRole('button', { name: 'Archive submission', exact: true })
        .click();
      await expect(alex.locator('.badge.closed')).toBeVisible();
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await page.locator('[data-inbox-status="new"]').click();
      const jordan = page.locator('#entry-' + ids.jordan);
      await expect(page.locator('#entries .entry')).toHaveCount(1);
      await jordan.locator(':scope > summary').click();
      await jordan
        .getByRole('button', { name: 'Mark reviewed', exact: true })
        .click();
      await expect(jordan).toHaveCount(0);
      await expect(page.locator('#entries')).toContainText(
        'No submissions match these filters.',
      );
    },
  );

  await check(
    'Phone themes preserve grouped survey search without horizontal overflow',
    async (page) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const host = await inline(page);
      await host
        .getByRole('button', { name: 'Expand all answers', exact: true })
        .click();
      await expect(host.locator('.response-person[open]')).toHaveCount(1);
      for (const theme of ['light', 'dark', 'system']) {
        await page.locator(`[data-appearance="${theme}"]`).click();
        await expect(page.locator('#survey-title-search')).toHaveValue(
          'Office feedback A',
        );
        await expect(host.locator('.survey-response[open]')).toHaveCount(2);
        await expect(host.locator('.response-person[open]')).toHaveCount(1);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          theme + ' overflow',
        );
      }
    },
  );
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
