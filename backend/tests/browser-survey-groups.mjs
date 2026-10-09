// Disposable local fixtures only. Run after npm run build.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { officeFixture } from './helpers/office-fixture.mjs';
import { builderSample } from './helpers/survey-response-samples.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import { saveEvent } from '../lib/events.mjs';
import { privateSurveyToken } from '../lib/custom-surveys.mjs';

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
    'All surveys includes searchable RSVP links, empty registrations and retained answers',
    async (page, fixture, ids) => {
      for (const [id, registrationOpen] of [
        ['empty-registration', true],
        ['disabled-registration', false],
      ])
        await saveEvent(
          fixture.db,
          {
            id,
            revision: 0,
            action: 'publish',
            event: {
              ...fixture.event.draft,
              title: id,
              registrationOpen,
              surveyQuestions: [],
            },
          },
          'officer@example.com',
        );
      // Answers remain discoverable when registration closes and is archived.
      const closed = await saveEvent(
        fixture.db,
        {
          id: ids.other,
          revision: 1,
          action: 'publish',
          event: {
            ...fixture.event.draft,
            title: 'Other group event',
            registrationOpen: false,
          },
        },
        'officer@example.com',
      );
      await saveEvent(
        fixture.db,
        { id: ids.other, revision: closed.revision, action: 'archive' },
        'officer@example.com',
      );
      await page.locator('#surveys-tab').click();
      const library = page.locator('#survey-library');
      const registrations = library.locator(
        'a[href^="#/surveys/events?event="]',
      );
      await expect(registrations).toHaveCount(3);
      await expect(library).not.toContainText('disabled-registration');
      await expect(library).toContainText('Office feedback A');
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page
        .getByRole('combobox', { name: 'Collection', exact: true })
        .selectOption('custom');
      await expect(registrations).toHaveCount(0);
      await page
        .getByRole('combobox', { name: 'Collection', exact: true })
        .selectOption('events');
      await expect(registrations).toHaveCount(3);
      await page
        .getByLabel('Search titles', { exact: true })
        .fill('no-matching-event');
      await expect(library).toHaveText('No surveys in this collection yet.');
      await page.getByLabel('Search titles', { exact: true }).fill('EMPTY-REG');
      await expect(registrations).toHaveCount(1);
      await registrations.press('Enter');
      await expect(page.locator('#survey-event')).toHaveValue(
        'empty-registration',
      );
      await expect(page.locator('#survey-results')).toContainText(
        'No RSVP responses match these filters.',
      );
      await page.locator('#surveys-tab').click();
      await page
        .getByLabel('Search titles', { exact: true })
        .fill('Other group');
      await expect(registrations).toHaveCount(1);
      await registrations.click();
      await expect(page.locator('#survey-event')).toHaveValue(ids.other);
      await expect(
        page.locator('#survey-results .survey-response'),
      ).toHaveCount(1);
    },
  );
  await check(
    'Basic question types work from builder and preview through respondent save and reload',
    async (page, fixture) => {
      await page.goto(fixture.origin + '/admin/#/surveys/new');
      await page
        .getByLabel('Survey title', { exact: true })
        .fill('Basic answers survey');
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page
        .getByLabel('Target audience', { exact: true })
        .selectOption('public');
      await page
        .getByLabel('Who can answer?', { exact: true })
        .selectOption('verified');
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      const types = [
        'text',
        'short',
        'date',
        'number',
        'email',
        'single',
        'multiple',
        'scale',
        'time',
        'availability',
      ];
      for (const type of types) {
        await page
          .getByRole('button', { name: 'Add question', exact: true })
          .click();
        const question = page.locator('.builder-question').last();
        await question
          .getByLabel('Question', { exact: true })
          .fill('Basic ' + type);
        await question
          .getByLabel('Answer type', { exact: true })
          .selectOption(type);
        await question
          .getByLabel('Required question', { exact: true })
          .setChecked(type !== 'availability');
        if (['single', 'multiple', 'availability'].includes(type))
          for (const [i, choice] of (type === 'availability'
            ? ['Afternoon', 'Evening']
            : ['First', 'Second']
          ).entries())
            await question
              .getByLabel('Choice ' + (i + 1), { exact: true })
              .fill(choice);
        if (type === 'availability') {
          for (const [i, date] of ['2026-10-16', '2026-10-17'].entries()) {
            await question
              .getByRole('button', { name: 'Add date', exact: true })
              .click();
            await question
              .getByLabel('Date ' + (i + 1), { exact: false })
              .fill(date);
          }
        }
        if (type === 'multiple')
          await question
            .getByLabel('Date for these choices (optional)', { exact: true })
            .fill('2026-10-16');
      }
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page.locator('.survey-trial > summary').click();
      const fillAnswers = async (root) => {
        for (const [type, value] of [
          ['text', 'First line\nSecond line'],
          ['short', 'Brief'],
          ['date', '2028-02-29'],
          ['number', '0'],
          ['email', 'advisor@example.edu'],
          ['time', '18:30'],
        ])
          await root
            .locator('input,textarea')
            .and(root.getByLabel(new RegExp('^Basic ' + type)))
            .fill(value);
        await root.getByRole('radio', { name: 'First', exact: true }).check();
        await root
          .getByRole('checkbox', { name: 'First', exact: true })
          .check();
        await root
          .getByRole('checkbox', { name: 'Second', exact: true })
          .check();
        await root
          .getByRole('combobox', { name: /^Basic scale/ })
          .selectOption('4');
        const availability = root.locator('.availability');
        await availability
          .getByRole('checkbox', {
            name: 'Fri, Oct 16, 2026 · Afternoon',
            exact: true,
          })
          .check();
        await availability
          .getByRole('radio', { name: 'Not sure yet', exact: true })
          .check();
        await expect(availability.getByRole('checkbox').first()).toBeDisabled();
        await expect(
          availability.getByRole('checkbox').first(),
        ).not.toBeChecked();
        await availability
          .getByRole('radio', { name: 'Not available', exact: true })
          .check();
        await expect(
          availability.getByLabel('Suggested date', { exact: true }),
        ).toBeVisible();
        await availability
          .getByLabel('Time (optional)', { exact: true })
          .fill('00:00');
        assert.equal(
          await availability
            .getByLabel('Suggested date', { exact: true })
            .evaluate((el) => el.checkValidity()),
          false,
        );
        await availability
          .getByLabel('Suggested date', { exact: true })
          .fill('2026-11-05');
        await availability
          .getByLabel('Time (optional)', { exact: true })
          .fill('00:00');
        await availability
          .getByRole('button', { name: 'Add another date', exact: true })
          .click();
        await availability
          .getByLabel('Suggested date', { exact: true })
          .nth(1)
          .fill('2026-11-06');
      };
      await fillAnswers(page.locator('.survey-trial'));
      await page
        .getByRole('button', {
          name: 'Preview how results will look',
          exact: true,
        })
        .click();
      const trial = page.getByRole('dialog', {
        name: 'Example admin results',
        exact: true,
      });
      await expect(trial).toContainText('advisor@example.edu');
      await expect(trial).toContainText('2028-02-29');
      await trial
        .getByRole('button', { name: 'Close results preview', exact: true })
        .click();
      const preview = await page.context().newPage();
      await preview.goto(
        await page
          .getByRole('link', { name: 'Open styled preview ↗', exact: true })
          .getAttribute('href'),
      );
      await preview
        .getByRole('button', { name: 'Preview the questions →', exact: true })
        .click();
      await expect(preview.locator('.question')).toHaveCount(10);
      await expect(
        preview.locator(
          '.question input:enabled,.question textarea:enabled,.question select:enabled',
        ),
      ).toHaveCount(0);
      await preview.close();
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Publish survey', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Close survey', exact: true }),
      ).toBeVisible();
      const survey = (
        await fixture.db.query(
          'SELECT id FROM club_forms.custom_surveys WHERE title=$1',
          ['Basic answers survey'],
        )
      ).rows[0];
      await page.goto(
        fixture.origin + '/surveys/#invite=' + privateSurveyToken(survey.id),
      );
      await page
        .getByRole('button', { name: 'Continue to questions →', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Email address', exact: true })
        .fill('typed@example.com');
      await page
        .getByRole('button', { name: 'Send sign-in code', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Sign-in code', exact: true })
        .fill('123456');
      await page
        .getByRole('button', { name: 'Verify and continue', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Your full name *', exact: true })
        .fill('Typed Student');
      await fillAnswers(page);
      await page.getByRole('textbox', { name: /^Basic email/ }).fill('invalid');
      await page
        .getByRole('button', { name: 'Review answers →', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Review your answers', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('textbox', { name: /^Basic email/ })
        .fill('advisor@example.edu');
      await page.setViewportSize({ width: 320, height: 820 });
      await page.screenshot({
        path: '../.preview/custom-survey-phone.png',
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page
        .getByRole('button', { name: 'Review answers →', exact: true })
        .click();
      await expect(page.locator('.answer-copy').nth(3)).toHaveText('0');
      await expect(page.locator('.answer-copy').nth(4)).toHaveText(
        'advisor@example.edu',
      );
      await page.getByRole('checkbox').check();
      await page
        .getByRole('button', { name: 'Submit answers', exact: true })
        .click();
      await expect(
        page.getByRole('heading', {
          name: 'Your response is saved',
          exact: true,
        }),
      ).toBeVisible();
      const saved = (
        await fixture.db.query(
          'SELECT responses FROM club_forms.custom_survey_responses WHERE survey_id=$1',
          [survey.id],
        )
      ).rows[0];
      assert.deepEqual(
        saved.responses.map((a) => a.value),
        [
          'First line\nSecond line',
          'Brief',
          '2028-02-29',
          0,
          'advisor@example.edu',
          0,
          [0, 1],
          4,
          '18:30',
          {
            status: 'unavailable',
            selections: [],
            alternatives: [
              { date: '2026-11-05', time: '00:00' },
              { date: '2026-11-06', time: '' },
            ],
          },
        ],
      );
      assert.equal(
        (
          await fixture.db.query(
            'SELECT definition FROM club_forms.custom_surveys WHERE id=$1',
            [survey.id],
          )
        ).rows[0].definition.questions[6].choiceDate,
        '2026-10-16',
      );
      await page.reload();
      await page
        .getByRole('button', { name: 'Continue to questions →', exact: true })
        .click();
      await expect(
        page.getByRole('spinbutton', { name: /^Basic number/ }),
      ).toHaveValue('0');
      await expect(
        page.getByRole('textbox', { name: /^Basic email/ }),
      ).toHaveValue('advisor@example.edu');
      await expect(
        page
          .locator('.availability')
          .getByRole('radio', { name: 'Not available', exact: true }),
      ).toBeChecked();
      await expect(
        page.getByLabel('Suggested date', { exact: true }).nth(0),
      ).toHaveValue('2026-11-05');
      await expect(
        page.getByLabel('Time (optional)', { exact: true }).nth(0),
      ).toHaveValue('00:00');
      await expect(
        page.getByLabel('Suggested date', { exact: true }).nth(1),
      ).toHaveValue('2026-11-06');
      await page
        .getByRole('button', { name: 'Clear availability', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Review answers →', exact: true })
        .click();
      await expect(page.locator('.answer-copy').last()).toHaveText(
        'Not answered',
      );
    },
  );

  await check(
    'Reopening survey pages resets dropdowns and keeps explicit event links scoped',
    async (page, fixture, ids) => {
      await page.locator('#surveys-tab').click();
      await page.locator('#survey-collection').selectOption('events');
      await expect(page.locator('#survey-library')).toContainText(
        'Office feedback A',
      );
      await page.locator('#home-tab').click();
      await page.locator('#surveys-tab').click();
      await expect(page.locator('#survey-collection')).toHaveValue('');
      const root = await events(page, fixture, ids.event);
      await root.locator('#survey-view').selectOption('archived');
      await root
        .getByRole('combobox', { name: /^Attendance/ })
        .selectOption('attended');
      await page.locator('#home-tab').click();
      await page.locator('#surveys-tab').click();
      await page.locator('#event-surveys-group').click();
      await expect(root.locator('#survey-event')).toHaveValue('');
      await expect(root.locator('#survey-view')).toHaveValue('active');
      await expect(
        root.getByRole('combobox', { name: /^Response type/ }),
      ).toHaveValue('all');
      await expect(
        root.getByRole('combobox', { name: /^Attendance/ }),
      ).toHaveValue('all');
      await expect(
        root.getByRole('combobox', { name: /^Feedback status/ }),
      ).toHaveValue('all');
      // Repeating the same destination must reset dropdowns too.
      await root.locator('#survey-view').selectOption('archived');
      await page.locator('#event-surveys-group').click();
      await expect(root.locator('#survey-view')).toHaveValue('active');
      await events(page, fixture, ids.other);
      await expect(root.locator('#survey-event')).toHaveValue(ids.other);
      await expect(root.locator('.survey-response')).toHaveCount(1);
      await page.goto(
        fixture.origin +
          '/admin/#/inbox?status=archived&type=rsvp-all&event=' +
          ids.event,
      );
      await page.locator('#home-tab').click();
      await page.locator('#inbox-tab').click();
      await expect(page.locator('#filters [name="kind"]')).toHaveValue('');
      await expect(page.locator('#filters [name="eventId"]')).toHaveValue('');
      await expect(
        page.locator('[data-inbox-status="current"]'),
      ).toHaveAttribute('aria-pressed', 'true');
    },
  );

  await check(
    'RSVP-enabled events appear before any response and retain empty filter/report scope',
    async (page, fixture, ids) => {
      for (const [id, action, registrationOpen] of [
        ['empty-workshop', 'publish', true],
        ['draft-workshop', 'draft', true],
        ['disabled-workshop', 'publish', false],
      ])
        await saveEvent(
          fixture.db,
          {
            id,
            revision: 0,
            action,
            event: {
              ...fixture.event.draft,
              title: id,
              date: '2030-10-23',
              registrationOpen,
              surveyQuestions: [],
            },
          },
          'officer@example.com',
        );
      await page.goto(fixture.origin + '/admin/#/surveys/events');
      const root = page.locator('#event-surveys-root'),
        select = root.locator('#survey-event'),
        empty = root.locator('.survey-event-group').filter({
          has: page.locator(':scope > summary', { hasText: 'empty-workshop' }),
        });
      await expect(
        select.locator('option[value="empty-workshop"]'),
      ).toHaveCount(1);
      await expect(
        select.locator('option[value="draft-workshop"]'),
      ).toHaveCount(1);
      await expect(
        select.locator('option[value="disabled-workshop"]'),
      ).toHaveCount(0);
      await expect(empty).toBeVisible();
      await expect(empty).toContainText('RSVP · 0 responses on this page');
      await expect(empty).toContainText(
        'No RSVP responses match these filters.',
      );
      await select.selectOption('empty-workshop');
      await expect(root.locator('.survey-event-group')).toHaveCount(1);
      await expect(select).toHaveValue('empty-workshop');
      await root
        .getByRole('combobox', { name: /^Response type/ })
        .selectOption('rsvp');
      await expect(empty).toBeVisible();
      await root.locator('#survey-search').fill('Nobody');
      await expect(empty).toContainText(
        'No RSVP responses match these filters.',
      );
      await root
        .getByRole('button', { name: 'Compile event summary', exact: true })
        .click();
      const report = page.getByRole('dialog', {
        name: 'Compiled answers',
        exact: true,
      });
      await expect(report).toContainText('0');
      await expect(report.locator('.survey-summary-group')).toHaveCount(0);
      await report.getByRole('button', { name: 'Close', exact: true }).click();
      const exported = await csv(
        page,
        root.getByRole('button', { name: 'Export event CSV', exact: true }),
      );
      assert.ok(!exported.includes('Alex Sample'));
      assert.equal(exported.trim().split(/\r?\n/).length, 1);
      await select.selectOption('');
      await expect(root.locator('.survey-event-group')).toHaveCount(0);
      await root.locator('#survey-search').fill('');
      await expect(empty).toBeVisible();
      await root
        .getByRole('combobox', { name: /^Response type/ })
        .selectOption('feedback');
      await expect(empty).toHaveCount(0);
      await expect(root.locator('.survey-event-group')).toHaveCount(1);
      await root
        .getByRole('combobox', { name: /^Response type/ })
        .selectOption('all');
      await select.selectOption(ids.event);
      await expect(root.locator('.survey-response')).toHaveCount(2);
      // Closing registration and archiving the event must keep saved answers accessible.
      await saveEvent(
        fixture.db,
        {
          id: ids.event,
          revision: fixture.event.revision,
          action: 'archive',
        },
        'officer@example.com',
      );
      await root.locator('#survey-reload').click();
      await expect(select).toHaveValue(ids.event);
      await expect(root.locator('.survey-response')).toHaveCount(2);
      await page.setViewportSize({ width: 375, height: 812 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    },
  );

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
    'Home totals match Upcoming & New while other saved feedback stays in Past',
    async (page, fixture) => {
      for (const name of ['Jordan Signup', 'Taylor Signup'])
        await fixture.db.query(
          `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data,created_at)
           VALUES($1::uuid,'join',$2,$3,$1::text,'{"campus":"Richland","interests":"Learning together"}',now()-interval '1 day')`,
          [
            randomUUID(),
            name.split(' ')[0].toLowerCase() + '@student.dallascollege.edu',
            name,
          ],
        );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      const signups = page.locator('#entries > .inbox-group').first();
      await expect(signups.locator(':scope > summary')).toHaveText(
        'Signups · 3 on this page',
      );
      await expect(signups).toContainText('Jordan Signup');
      await expect(signups).toContainText('Taylor Signup');
      for (const theme of ['light', 'dark']) {
        await page.locator(`[data-appearance="${theme}"]`).click();
        await signups.screenshot({
          path: fileURLToPath(
            new URL(
              `../../.preview/signups-priority-${theme}.png`,
              import.meta.url,
            ),
          ),
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await signups.screenshot({
        path: fileURLToPath(
          new URL('../../.preview/signups-priority-phone.png', import.meta.url),
        ),
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(
        page.locator('[data-inbox-status="current"]'),
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
        expected + ' upcoming & new submissions',
      );
      await expect(totals).not.toContainText('permanently deleted');
      await expect(totals).not.toContainText('saved (including');
      const question = totals
        .getByRole('link')
        .filter({ hasText: 'Questions & requests' });
      await expect(totals.locator('.total').nth(0)).toContainText('Signups');
      await expect(totals.locator('.total').nth(1)).toContainText(
        'Questions & requests',
      );
      await expect(question.locator('strong')).toHaveText('3');
      await question.click();
      await expect(
        page.locator('[data-inbox-status="current"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#entries')).toContainText('Reviewed question');
      await expect(page.locator('#entries')).toContainText('Office workshop');
      await expect(page.locator('#filters [name="kind"]')).toHaveValue(
        'questions-requests',
      );
      await expect(page.locator('#entries')).not.toContainText(
        'Archived question',
      );
      await page.locator('[data-inbox-status="closed"]').click();
      await expect(page.locator('#entries')).toContainText('Archived question');
      await page.locator('#home-tab').click();
      const feedback = totals
        .getByRole('link')
        .filter({ hasText: 'Event feedback' });
      await expect(feedback.locator('strong')).toHaveText('0');
      await feedback.click();
      await expect(page.locator('#filters [name="kind"]')).toHaveValue(
        'feedback',
      );
      await expect(page.locator('#entries .entry')).toHaveCount(0);
      await page.getByRole('button', { name: 'Past', exact: true }).click();
      await expect(page.locator('#entries')).toContainText('Office feedback A');
      await expect(page.locator('#entries')).toContainText('Office feedback B');
      await expect(page.locator('#entries')).not.toContainText(
        'Archived feedback',
      );
    },
  );

  await check(
    'Inbox archive and restore preserve responses and group counts',
    async (page, fixture, ids) => {
      await page.goto(
        fixture.origin + '/admin/#/inbox?type=rsvp-all&event=' + ids.event,
      );
      const alex = page.locator('#entry-' + ids.alex);
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await alex.locator(':scope > summary').click();
      await expect(
        alex.getByRole('button', { name: 'Mark reviewed', exact: true }),
      ).toHaveCount(0);
      await alex
        .getByRole('button', { name: 'Archive submission', exact: true })
        .click();
      await expect(alex).toHaveCount(0);
      await expect(page.locator('.inbox-group > summary')).toHaveText(
        'Office audit event · 1 RSVP',
      );
      await page.locator('[data-inbox-status="closed"]').click();
      await expect(alex).toHaveCount(1);
      await alex.locator(':scope > summary').click();
      await expect(
        alex.getByRole('button', { name: 'Delete permanently', exact: true }),
      ).toBeVisible();
      await alex
        .getByRole('button', { name: 'Restore submission', exact: true })
        .click();
      await expect(alex).toHaveCount(0);
      await page.locator('[data-inbox-status="current"]').click();
      await expect(page.locator('#entries .entry')).toHaveCount(2);
      await expect(page.locator('.inbox-group > summary')).toHaveText(
        'Office audit event · 2 RSVPs',
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
