import { email as validEmail } from './validation.mjs';
import { RequestError } from './errors.mjs';

export async function contactAliases(db, primary) {
  return (
    await db.query(
      `SELECT a.email,
    (SELECT count(*)::int FROM club_forms.entries e WHERE e.email=a.email) AS submissions,
    (SELECT count(*)::int FROM club_forms.contact_notes n WHERE n.email=a.email) AS notes,
    (SELECT coalesce(jsonb_agg(recent),'[]'::jsonb) FROM (SELECT e.id,e.kind,coalesce(e.data->>'eventTitle',e.data->>'subject',e.data->>'topic',e.data->>'title',e.kind) AS title FROM club_forms.entries e WHERE e.email=a.email ORDER BY e.created_at DESC,e.id LIMIT 5) recent) AS responses,
    EXISTS(SELECT 1 FROM club_forms.custom_survey_members m WHERE m.email=a.email) AS membership
    FROM club_forms.contact_emails a WHERE contact_email=$1 AND is_active ORDER BY a.email`,
      [primary],
    )
  ).rows;
}

export async function editContact(db, body, actor) {
  const source = validEmail(body.email);
  const removing = body.action === 'contact-remove-alias';
  if (
    !['contact-edit', 'contact-remove-alias'].includes(body.action) ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 1
  )
    throw new RequestError(400, 'Refresh this contact before editing.');
  const keys = [
    'action',
    'email',
    'revision',
    ...(removing ? ['alias'] : ['name', 'primaryEmail']),
  ];
  if (Object.keys(body).some((key) => !keys.includes(key)))
    throw new RequestError(
      400,
      'Only the contact name and primary address can be edited here.',
    );
  const target = validEmail(removing ? body.alias : body.primaryEmail);
  if (
    !removing &&
    (typeof body.name !== 'string' ||
      body.name.length > 100 ||
      /[\x00-\x1f\x7f]/.test(body.name))
  )
    throw new RequestError(400, 'Keep the name under 100 characters.');
  return db.transaction(async (tx) => {
    await tx.query(
      'LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE',
    );
    const contact = (
      await tx.query(
        `SELECT c.* FROM club_forms.contacts c JOIN club_forms.contact_emails a ON a.contact_email=c.email WHERE a.email=$1`,
        [source],
      )
    ).rows[0];
    if (!contact) throw new RequestError(404, 'Contact not found.');
    if (contact.email !== source || contact.revision !== body.revision)
      throw new RequestError(
        409,
        'This contact changed. Refresh its history and review the action again.',
      );
    if (contact.deleted_at)
      throw new RequestError(409, 'Restore this contact before editing.');
    const aliases = await contactAliases(tx, source);
    if (removing) {
      if (target === source)
        throw new RequestError(
          400,
          'Choose a different primary email before removing this address.',
        );
      const alias = aliases.find((row) => row.email === target);
      if (!alias) throw new RequestError(404, 'Linked address not found.');
      await tx.query(
        'UPDATE club_forms.contact_emails SET is_active=false WHERE email=$1',
        [target],
      );
      await tx.query(
        'UPDATE club_forms.contacts SET revision=revision+1 WHERE email=$1',
        [source],
      );
      await tx.query(
        "INSERT INTO club_forms.contact_activity(email,actor,action,details) VALUES($1,$2,'Address removed',$3)",
        [
          source,
          actor,
          'Removed linked address ' +
            target +
            '. Saved records remain in this contact history.',
        ],
      );
      return { email: source, aliasRemoved: true };
    }
    const linked = (
      await tx.query(
        'SELECT contact_email,is_active FROM club_forms.contact_emails WHERE email=$1',
        [target],
      )
    ).rows[0];
    if (linked && linked.contact_email !== source)
      throw new RequestError(
        409,
        'That address belongs to another contact. Merge the contacts first, then choose the primary address.',
      );
    if (linked && !linked.is_active)
      throw new RequestError(
        409,
        'That address was removed. Choose an active linked email or enter a new address.',
      );
    const name = body.name.trim();
    if (target !== source) {
      if (!linked)
        await tx.query(
          `INSERT INTO club_forms.contacts(email,name,first_seen,last_seen,is_test,revision,name_locked) VALUES($1,$2,$3,$4,$5,$6,true)`,
          [
            target,
            name,
            contact.first_seen,
            contact.last_seen,
            contact.is_test,
            contact.revision + 1,
          ],
        );
      else
        await tx.query(
          `UPDATE club_forms.contacts SET name=$2,first_seen=$3,last_seen=$4,is_test=$5,deleted_at=NULL,deleted_by=NULL,revision=greatest(revision,$6)+1,name_locked=true WHERE email=$1`,
          [
            target,
            name,
            contact.first_seen,
            contact.last_seen,
            contact.is_test,
            contact.revision,
          ],
        );
      await tx.query(
        'INSERT INTO club_forms.contact_emails(email,contact_email) VALUES($1,$1) ON CONFLICT(email) DO NOTHING',
        [target],
      );
      await tx.query(
        'UPDATE club_forms.contact_emails SET contact_email=$1 WHERE contact_email=$2',
        [target, source],
      );
      await tx.query(
        'UPDATE club_forms.contacts SET revision=revision+1 WHERE email=$1',
        [source],
      );
    } else
      await tx.query(
        'UPDATE club_forms.contacts SET name=$2,name_locked=true,revision=revision+1 WHERE email=$1',
        [source, name],
      );
    await tx.query(
      "INSERT INTO club_forms.contact_activity(email,actor,action,details) VALUES($1,$2,'Contact edited',$3)",
      [
        target,
        actor,
        target === source
          ? 'Updated the contact name.'
          : 'Primary email changed from ' + source + ' to ' + target + '.',
      ],
    );
    return { email: target, edited: true };
  });
}
