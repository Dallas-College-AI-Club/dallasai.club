import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import {
  changeRespondent,
  respondentList,
} from '../lib/survey-respondents.mjs';
import {
  rememberDevice,
  requireDevice,
  deviceCookie,
  submitSurvey,
  currentResponses,
} from '../lib/custom-surveys.mjs';
import { definition } from '../lib/survey-contract.mjs';
const actor = { id: 'test-admin', email: 'officer@example.com' };
const add = (f, revision = 0) => ({
  surveyId: f.id,
  action: 'add',
  name: 'Test Officer',
  email: 'OFFICER@example.com',
  expectedRevision: revision,
  requestId: randomUUID(),
});
const answer = (
  f,
  id = 'pearlman',
  audience = ['club_officers', 'bracewell'],
) => ({
  format: 'advisor-studio-shared/9',
  contentVersion: definition.content_version,
  advisorId: id,
  consent: { reviewed: true, audience },
  responses: [
    {
      id: 'note-spark',
      kind: 'comment',
      pageId: 'spark',
      mode: 'narrative',
      text: 'Shared with the agreed audience.',
      wordingReviewed: true,
      included: true,
    },
  ],
  requestId: randomUUID(),
  expectedRevision: 0,
});
const user = (email) => ({ id: 'neon-' + email, email, emailVerified: true });
async function device(f, email) {
  const survey = (
    await f.db.query('SELECT * FROM club_forms.custom_surveys WHERE id=$1', [
      f.id,
    ])
  ).rows[0];
  const result = await rememberDevice(f.db, survey, user(email));
  return {
    survey,
    req: { headers: { cookie: deviceCookie(survey) + '=' + result.token } },
    member: result.member,
  };
}

test('respondent additions, removals and restores record the real admin and retry only once', async () => {
  const f = await fixture();
  try {
    const input = add(f);
    await changeRespondent(f.db, actor, input);
    await changeRespondent(f.db, actor, input);
    let list = await respondentList(f.db, f.id);
    assert.equal(list.revision, 1);
    assert.equal(list.activity.length, 1);
    const member = list.members.find((m) => m.email === 'officer@example.com');
    assert.ok(member.active);
    assert.notEqual(member.advisor_id, 'pearlman');
    assert.equal(list.activity[0].actor_email, actor.email);
    assert.equal(list.activity[0].respondent_email, 'officer@example.com');
    const d = await device(f, 'officer@example.com');
    const remove = {
      surveyId: f.id,
      action: 'remove',
      advisorId: member.advisor_id,
      expectedRevision: 1,
      requestId: randomUUID(),
    };
    await changeRespondent(f.db, actor, remove);
    await changeRespondent(f.db, actor, remove);
    await assert.rejects(
      requireDevice(f.db, d.req, d.survey),
      (e) => e.status === 401,
    );
    await changeRespondent(f.db, actor, add(f, 2));
    list = await respondentList(f.db, f.id);
    assert.equal(
      list.members.find((m) => m.email === 'officer@example.com').advisor_id,
      member.advisor_id,
    );
    assert.deepEqual(
      list.activity.map((a) => a.action),
      ['respondent_restored', 'respondent_removed', 'respondent_added'],
    );
    await assert.rejects(
      requireDevice(f.db, d.req, d.survey),
      (e) => e.status === 401,
    );
  } finally {
    await f.db.close();
  }
});

test('permanent response deletion requires Archived, erases answers receipts and devices once, and keeps membership', async () => {
  for (const archiveParent of [false, true]) {
    const f = await fixture();
    try {
      const d = await device(f, 'pearlman@example.com');
      await submitSurvey(f.db, d.req, f.token, answer(f));
      const input = {
        surveyId: f.id,
        advisorId: 'pearlman',
        action: 'delete',
        expectedRevision: 0,
        requestId: randomUUID(),
      };
      await assert.rejects(changeRespondent(f.db, actor, input), {
        status: 409,
      });
      assert.equal(
        (await currentResponses(f.db, f.id))[0].responses?.length ||
          (await currentResponses(f.db, f.id))[1].responses?.length,
        1,
      );
      if (archiveParent)
        await f.db.query(
          "UPDATE club_forms.custom_surveys SET status='archived' WHERE id=$1",
          [f.id],
        );
      else {
        await changeRespondent(f.db, actor, {
          ...input,
          action: 'remove',
          requestId: randomUUID(),
        });
        input.expectedRevision = 1;
      }
      const result = await changeRespondent(f.db, actor, input);
      assert.deepEqual(await changeRespondent(f.db, actor, input), result);
      for (const table of ['responses', 'receipts', 'devices'])
        assert.equal(
          (
            await f.db.query(
              'SELECT count(*)::int n FROM club_forms.custom_survey_' +
                table +
                ' WHERE survey_id=$1 AND advisor_id=$2',
              [f.id, 'pearlman'],
            )
          ).rows[0].n,
          0,
        );
      const member = (
        await f.db.query(
          'SELECT active FROM club_forms.custom_survey_members WHERE survey_id=$1 AND advisor_id=$2',
          [f.id, 'pearlman'],
        )
      ).rows[0];
      assert.equal(member.active, archiveParent);
      assert.equal(
        (await respondentList(f.db, f.id)).activity.filter(
          (a) => a.action === 'response_deleted',
        ).length,
        1,
      );
      await assert.rejects(
        changeRespondent(f.db, actor, {
          ...input,
          requestId: randomUUID(),
          expectedRevision: result.revision,
        }),
        { status: 409 },
      );
      await assert.rejects(
        changeRespondent(f.db, actor, { ...input, action: 'remove' }),
        { status: 409 },
      );
    } finally {
      await f.db.close();
    }
  }
});

test('new respondents cannot read summaries shared before they joined; new consent can include them', async () => {
  const f = await fixture();
  try {
    const pearlman = await device(f, 'pearlman@example.com');
    const first = answer(f);
    await submitSurvey(f.db, pearlman.req, f.token, first);
    await changeRespondent(f.db, actor, add(f));
    const list = await respondentList(f.db, f.id),
      added = list.members.find((m) => m.email === 'officer@example.com');
    assert.equal(
      (await currentResponses(f.db, f.id, added.advisor_id)).find(
        (r) => r.advisor_id === 'pearlman',
      ).responses,
      null,
    );
    assert.equal(
      (await currentResponses(f.db, f.id, 'bracewell')).find(
        (r) => r.advisor_id === 'pearlman',
      ).responses.length,
      1,
    );
    await submitSurvey(f.db, pearlman.req, f.token, {
      ...answer(f, 'pearlman', [
        'club_officers',
        'bracewell',
        added.advisor_id,
      ]),
      expectedRevision: 1,
    });
    assert.equal(
      (await currentResponses(f.db, f.id, added.advisor_id)).find(
        (r) => r.advisor_id === 'pearlman',
      ).responses.length,
      1,
    );
    const newDevice = await device(f, 'officer@example.com');
    await submitSurvey(
      f.db,
      newDevice.req,
      f.token,
      answer(f, added.advisor_id, ['club_officers', 'pearlman', 'bracewell']),
    );
    await changeRespondent(f.db, actor, {
      surveyId: f.id,
      action: 'remove',
      advisorId: added.advisor_id,
      expectedRevision: 1,
      requestId: randomUUID(),
    });
    const saved = (await currentResponses(f.db, f.id)).find(
      (r) => r.advisor_id === added.advisor_id,
    );
    assert.equal(saved.active, false);
    assert.equal(saved.responses.length, 1);
  } finally {
    await f.db.close();
  }
});

test('stale changes, duplicate emails, forged actor fields and reused request IDs are rejected', async () => {
  const f = await fixture();
  try {
    const first = add(f);
    await changeRespondent(f.db, actor, first);
    await assert.rejects(
      changeRespondent(f.db, actor, add(f)),
      (e) => e.status === 409,
    );
    await assert.rejects(
      changeRespondent(f.db, actor, add(f, 1)),
      (e) => e.status === 409,
    );
    await assert.rejects(
      changeRespondent(f.db, actor, { ...first, name: 'Another name' }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      changeRespondent(f.db, actor, {
        ...add(f, 1),
        actor_email: 'forged@example.com',
      }),
      (e) => e.status === 400,
    );
    assert.equal((await respondentList(f.db, f.id)).activity.length, 1);
  } finally {
    await f.db.close();
  }
});

test('audit failure rolls back access changes', async () => {
  const f = await fixture();
  try {
    const failing = {
      transaction: (fn) =>
        f.db.transaction((tx) =>
          fn({
            query: (sql, args) => {
              if (
                sql.startsWith('INSERT INTO club_forms.custom_survey_activity')
              )
                throw Error('Synthetic audit failure');
              return tx.query(sql, args);
            },
          }),
        ),
    };
    await assert.rejects(
      changeRespondent(failing, actor, add(f)),
      /Synthetic audit/,
    );
    const list = await respondentList(f.db, f.id);
    assert.equal(list.members.length, 2);
    assert.equal(list.revision, 0);
    assert.equal(list.activity.length, 0);
  } finally {
    await f.db.close();
  }
});

test('respondent administration requires officer authentication and same origin, even for an authenticated respondent', async () => {
  const f = await fixture(),
    server = http.createServer(f.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  try {
    const route = '/api/custom-surveys?action=';
    for (const cookie of ['', 'test-neon=pearlman']) {
      assert.equal(
        (
          await fetch(origin + route + 'members&id=' + f.id, {
            headers: { Cookie: cookie },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(origin + route + 'member-change', {
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: cookie,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(add(f)),
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await fetch(origin + route + 'member-change', {
          method: 'POST',
          headers: {
            Origin: 'https://outside.invalid',
            Cookie: 'test-officer=yes',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(add(f)),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + route + 'member-change', {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: 'test-officer=yes',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(add(f)),
        })
      ).status,
      200,
    );
    const list = await (
      await fetch(origin + route + 'members&id=' + f.id, {
        headers: { Cookie: 'test-officer=yes' },
      })
    ).json();
    assert.equal(list.currentUser.email, actor.email);
    assert.equal(list.activity.length, 1);
  } finally {
    await new Promise((r) => server.close(r));
    await f.db.close();
  }
});

test('a self-registered respondent with a blank name can be restored; a new one still needs a name', async () => {
  const f = await fixture();
  try {
    // Self-registration stores a blank name rather than the email address.
    await f.db.query(
      "INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,'self-registered','','joined@example.com',false)",
      [f.id],
    );
    const restore = {
      surveyId: f.id,
      action: 'add',
      name: '',
      email: 'Joined@example.com',
      expectedRevision: 0,
      requestId: randomUUID(),
    };
    assert.deepEqual(await changeRespondent(f.db, actor, restore), {
      revision: 1,
    });
    const list = await respondentList(f.db, f.id);
    const member = list.members.find((m) => m.email === 'joined@example.com');
    assert.deepEqual(
      [member.advisor_id, member.active, member.display_name],
      ['self-registered', true, ''],
    );
    assert.equal(list.activity[0].action, 'respondent_restored');
    for (const email of ['someone-new@example.com', 'not-an-email'])
      await assert.rejects(
        changeRespondent(f.db, actor, {
          ...restore,
          email,
          expectedRevision: 1,
          requestId: randomUUID(),
        }),
        { status: 400 },
      );
    assert.equal((await respondentList(f.db, f.id)).revision, 1);
  } finally {
    await f.db.close();
  }
});
