import { RequestError } from './errors.mjs';
export async function manageEntry(db, { id, action, iat }) {
  return db.transaction(async (tx) => {
    const entry = (
      await tx.query(
        'SELECT * FROM club_forms.entries WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!entry) throw new RequestError(404, 'This request could not be found.');
    if (
      (action === 'unsubscribe' && entry.kind !== 'subscribe') ||
      (action === 'cancel' && entry.kind !== 'rsvp') ||
      (action === 'confirm' &&
        !['subscribe', 'join', 'rsvp'].includes(entry.kind))
    )
      throw new RequestError(400, 'This link cannot be used for that request.');
    if (action === 'confirm' && entry.kind === 'rsvp') {
      const date = entry.data.eventDate;
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? date < today
          : new Date(date) <= new Date()
      )
        throw new RequestError(400, 'This event has already passed.');
    }
    if (entry.state === 'suppressed' && action === 'confirm')
      throw new RequestError(
        400,
        'Email delivery to this address is blocked. Contact the club for help.',
      );
    if (
      action === 'confirm' &&
      ['unsubscribed', 'cancelled'].includes(entry.state) &&
      (!iat || new Date(entry.updated_at).getTime() > iat)
    )
      throw new RequestError(
        400,
        'This confirmation link has already been cancelled. Please submit the form again.',
      );
    const state =
      action === 'unsubscribe'
        ? 'unsubscribed'
        : action === 'cancel'
          ? 'cancelled'
          : 'active';
    if (entry.state !== state || !entry.email_verified) {
      await tx.query(
        'UPDATE club_forms.entries SET state=$2,email_verified=true,updated_at=now() WHERE id=$1',
        [id, state],
      );
      if (entry.kind === 'subscribe')
        await tx.query(
          `INSERT INTO club_forms.outbox(entry_id,kind,dedupe_key) VALUES($1,'newsletter',$2)`,
          [id, `newsletter:${id}:${crypto.randomUUID()}`],
        );
      await tx.query(
        `INSERT INTO club_forms.audit(actor,entry_id,action) VALUES('email-link',$1,$2)`,
        [id, action],
      );
    }
    return {
      message:
        action === 'unsubscribe'
          ? 'You have been unsubscribed from The AI Review.'
          : action === 'cancel'
            ? 'Your RSVP has been cancelled.'
            : entry.kind === 'subscribe'
              ? 'Your email is confirmed. You are subscribed to The AI Review.'
              : entry.kind === 'join'
                ? 'Your email is confirmed. Welcome to the club!'
                : 'Your email is confirmed. Your RSVP is saved.',
      kind: entry.kind,
    };
  });
}
