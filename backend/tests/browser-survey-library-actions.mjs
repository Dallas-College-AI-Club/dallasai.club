// Disposable local fixture only. Run after npm run build.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officeFixture } from './helpers/office-fixture.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';

const f = await officeFixture();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
try {
  const ids = [];
  for (const [title, eventId] of [
    ['Row standalone draft', undefined],
    ['Row event draft', f.event.id],
  ]) {
    const id = randomUUID();
    ids.push(id);
    const definition = {
      template: 'feedback',
      title,
      intro: '',
      audience: 'public',
      permissions: { preview: 'link', answer: 'verified', results: 'admins' },
      durationDays: 30,
      questions: [
        {
          id: randomUUID(),
          title: 'Feedback',
          description: '',
          type: 'text',
          required: false,
          options: [],
        },
      ],
      ...(eventId ? { eventId } : {}),
    };
    await changeDraft(
      f.db,
      { email: 'officer@example.com' },
      {
        id,
        action: 'save',
        expectedRevision: 0,
        definition,
        requestId: randomUUID(),
      },
    );
  }
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(f.origin + '/test-signin');
  await expect(page.locator('#office')).toBeVisible();
  await page.goto(f.origin + '/admin/#/surveys');
  const library = page.locator('#survey-library');
  const row = (title) =>
    library.locator('details.survey-library-row').filter({
      has: page.locator(':scope > summary strong').filter({ hasText: title }),
    });
  const standalone = row('Row standalone draft'),
    event = row('Row event draft');
  for (const card of [standalone, event]) {
    await expect(card).toHaveCount(1);
    await expect(card).not.toHaveAttribute('open', '');
    await expect(
      card
        .locator(':scope > summary')
        .getByRole('button', { name: 'Archive survey', exact: true }),
    ).toBeVisible();
  }
  assert.equal(
    await library.getByRole('button', { name: /^Archived surveys/ }).count(),
    0,
  );
  await standalone
    .locator(':scope > summary')
    .getByRole('button', { name: 'Archive survey', exact: true })
    .click();
  await page.evaluate(() => {
    location.hash = '#/contacts';
  });
  await expect(page.locator('#contacts-pane')).toBeVisible();
  await page.locator('#confirm-dialog [data-confirm]').click();
  await page.goto(f.origin + '/admin/#/surveys');
  await expect(
    standalone
      .locator(':scope > summary')
      .getByRole('button', { name: 'Archive survey', exact: true }),
  ).toBeVisible();
  await standalone
    .locator(':scope > summary')
    .getByRole('button', { name: 'Archive survey', exact: true })
    .click();
  await f.db.query(
    'UPDATE club_forms.custom_surveys SET edit_revision=edit_revision+1 WHERE id=$1',
    [ids[0]],
  );
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(standalone.locator(':scope > summary')).toContainText(
    'Another admin changed',
  );
  await expect(standalone).not.toHaveAttribute('open', '');
  assert.equal(
    (
      await f.db.query(
        'SELECT status FROM club_forms.custom_surveys WHERE id=$1',
        [ids[0]],
      )
    ).rows[0].status,
    'draft',
  );
  await page.locator('#survey-library-refresh').click();
  const act = async (card, name) => {
    await card
      .locator(':scope > summary')
      .getByRole('button', { name, exact: true })
      .click();
    await page.locator('#confirm-dialog [data-confirm]').click();
  };
  await expect(standalone.locator(':scope > summary')).not.toContainText(
    'Another admin changed',
  );
  await act(standalone, 'Archive survey');
  await expect(
    library.getByRole('button', { name: 'Archived surveys (1)', exact: true }),
  ).toBeVisible();
  await expect(
    standalone
      .locator(':scope > summary')
      .getByRole('button', { name: 'Restore as draft', exact: true }),
  ).toBeVisible();
  await expect(
    standalone
      .locator(':scope > summary')
      .getByRole('button', { name: 'Delete survey permanently', exact: true }),
  ).toBeVisible();
  assert.equal(
    await library
      .locator('.survey-library-section')
      .last()
      .getAttribute('data-group'),
    'Archived',
  );
  await library
    .getByRole('button', { name: 'Archived surveys (1)', exact: true })
    .click();
  await expect(
    library.getByRole('heading', { name: 'Archived', exact: true }),
  ).toBeFocused();
  await act(standalone, 'Restore as draft');
  await expect(
    standalone
      .locator(':scope > summary')
      .getByRole('button', { name: 'Archive survey', exact: true }),
  ).toBeVisible();
  await act(event, 'Archive survey');
  await expect(
    event
      .locator(':scope > summary')
      .getByRole('button', { name: 'Delete survey permanently', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(
    event
      .locator(':scope > summary')
      .getByRole('button', { name: 'Restore as draft', exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await act(event, 'Delete survey permanently');
  await expect(event).toHaveCount(0);
  assert.equal(
    (
      await f.db.query('SELECT id FROM club_forms.events WHERE id=$1', [
        f.event.id,
      ])
    ).rows.length,
    1,
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  const rsvp = library
    .locator('.rsvp-survey-library-row')
    .filter({ hasText: f.event.draft.title });
  const rsvpEntry = f.entries.find((entry) => entry.kind === 'rsvp');
  const activeEntry = randomUUID();
  await f.db.query(
    "INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) SELECT $1::uuid,kind,'parent-active@example.edu','Parent active response',$1::text,data FROM club_forms.entries WHERE id=$2",
    [activeEntry, rsvpEntry.id],
  );
  await f.db.query(
    'INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,event_date,survey_version,questions,answers) SELECT $1,event_id,event_title,event_date,survey_version,questions,answers FROM club_forms.survey_responses WHERE entry_id=$2',
    [activeEntry, rsvpEntry.id],
  );
  await f.db.query(
    "INSERT INTO club_forms.survey_response_state(entry_id,archived_at,updated_by) VALUES($1,now()-interval '1 day','officer@example.com')",
    [rsvpEntry.id],
  );
  const originalArchive = (
    await f.db.query(
      'SELECT archived_at FROM club_forms.survey_response_state WHERE entry_id=$1',
      [rsvpEntry.id],
    )
  ).rows[0].archived_at;
  const originalStatus = (
    await f.db.query(
      'SELECT review_status FROM club_forms.entries WHERE id=$1',
      [rsvpEntry.id],
    )
  ).rows[0].review_status;
  await rsvp
    .getByRole('button', { name: 'Archive RSVP survey', exact: true })
    .click();
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(
    rsvp.getByRole('button', { name: 'Restore RSVP survey', exact: true }),
  ).toBeVisible();
  await expect(
    rsvp.getByRole('link', { name: 'Open responses →', exact: true }),
  ).toHaveAttribute('href', /view=archived/);
  await page.goto(f.origin + '/admin/#/inbox?status=archived&type=rsvp');
  const inboxCard = page.locator('#entry-' + rsvpEntry.id);
  await expect(inboxCard).toBeVisible();
  await inboxCard.locator(':scope > summary').click();
  await expect(
    inboxCard.getByRole('link', {
      name: 'Manage archived RSVP survey',
      exact: true,
    }),
  ).toHaveAttribute('href', '#/surveys');
  await expect(
    inboxCard.getByRole('button', { name: 'Restore submission', exact: true }),
  ).toHaveCount(0);
  await expect(
    inboxCard.getByRole('button', { name: 'Delete permanently', exact: true }),
  ).toHaveCount(0);
  await page.goto(f.origin + '/admin/#/surveys');
  await rsvp
    .getByRole('link', { name: 'Open responses →', exact: true })
    .click();
  const eventResponse = page
    .locator('#event-surveys-root .survey-response')
    .first();
  await expect(eventResponse).toBeVisible();
  await eventResponse.locator(':scope > summary').click();
  await expect(
    eventResponse.getByRole('link', {
      name: 'Manage archived RSVP survey',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    eventResponse.getByRole('button', { name: /^(Restore|Archive)$/ }),
  ).toHaveCount(0);
  await expect(
    eventResponse.getByRole('button', {
      name: 'Delete permanently',
      exact: true,
    }),
  ).toBeHidden();
  await expect(page.locator('#survey-view')).toHaveValue('archived');
  const activeResponse = page.locator(
    '#event-surveys-root .survey-response[data-entry-id="' + activeEntry + '"]',
  );
  await expect(activeResponse).toBeVisible();
  if (!(await activeResponse.getAttribute('open'))) await activeResponse.evaluate(card => { card.open = true; });
  for (const [button, starred] of [
    ['☆ Star', true],
    ['★ Unstar', false],
  ]) {
    await activeResponse
      .getByRole('button', { name: button, exact: true })
      .click();
    await expect(activeResponse).toBeVisible();
    await expect(activeResponse.locator(':scope > summary')).toContainText(
      'Archived',
    );
    await expect(
      activeResponse.getByRole('button', {
        name: starred ? '★ Unstar' : '☆ Star',
        exact: true,
      }),
    ).toBeVisible();
    const raw = (
      await f.db.query(
        'SELECT archived_at,starred FROM club_forms.survey_response_state WHERE entry_id=$1',
        [activeEntry],
      )
    ).rows[0];
    assert.equal(raw.archived_at, null);
    assert.equal(raw.starred, starred);
  }
  await page.goto(f.origin + '/admin/#/surveys/events?event=' + f.event.id);
  await expect(page.locator('#survey-view')).toHaveValue('active');
  await expect(
    page.locator('#event-surveys-root .survey-response'),
  ).toHaveCount(0);
  await page.goto(f.origin + '/admin/#/surveys');
  await rsvp
    .getByRole('button', { name: 'Restore RSVP survey', exact: true })
    .click();
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(
    rsvp.getByRole('button', { name: 'Archive RSVP survey', exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await f.db.query(
        'SELECT review_status FROM club_forms.entries WHERE id=$1',
        [rsvpEntry.id],
      )
    ).rows[0].review_status,
    originalStatus,
  );
  assert.deepEqual(
    (
      await f.db.query(
        'SELECT archived_at FROM club_forms.survey_response_state WHERE entry_id=$1',
        [rsvpEntry.id],
      )
    ).rows[0].archived_at,
    originalArchive,
  );
  assert.equal(
    (
      await f.db.query('SELECT draft FROM club_forms.events WHERE id=$1', [
        f.event.id,
      ])
    ).rows[0].draft.registrationOpen,
    false,
  );
  await rsvp
    .getByRole('button', { name: 'Archive RSVP survey', exact: true })
    .click();
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(
    rsvp.getByRole('button', {
      name: 'Delete RSVP survey permanently',
      exact: true,
    }),
  ).toBeVisible();
  await rsvp
    .getByRole('button', {
      name: 'Delete RSVP survey permanently',
      exact: true,
    })
    .click();
  await expect(page.locator('#confirm-dialog')).toContainText(
    '2 saved responses',
  );
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(rsvp).toHaveCount(0);
  await page.locator('#survey-library-refresh').click();
  await expect(rsvp).toHaveCount(0);
  assert.equal(
    (
      await f.db.query('SELECT id FROM club_forms.events WHERE id=$1', [
        f.event.id,
      ])
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await f.db.query('SELECT id FROM club_forms.entries WHERE id=$1', [
        rsvpEntry.id,
      ])
    ).rows.length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS collapsed custom and RSVP row actions, stale revision and route guards, Archived jump/order, restore, permanent delete, archived parent controls, active navigation default, retained event and phone width',
  );
} finally {
  await context.close();
  await browser.close();
  await f.close();
}
