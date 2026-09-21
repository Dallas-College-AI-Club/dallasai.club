export async function applyEmailEvent(db, event, eventId) {
  await db.transaction(async (tx) => {
    const received = await tx.query(
      'INSERT INTO club_forms.webhook_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
      [eventId],
    );
    if (!received.rows.length) return;
    const unsubscribed =
      (event.type === 'contact.updated' && event.data.unsubscribed === true) ||
      event.type === 'contact.deleted';
    const suppressed = [
      'email.bounced',
      'email.complained',
      'email.suppressed',
    ].includes(event.type);
    if (!unsubscribed && !suppressed) return;
    const emails = unsubscribed ? [event.data.email] : event.data.to || [];
    for (const address of emails) {
      if (typeof address !== 'string') continue;
      // Old webhook deliveries must not undo a later, explicit confirmation.
      await tx.query(
        `UPDATE club_forms.entries SET state=$2,updated_at=now() WHERE kind='subscribe' AND email=$1 AND updated_at <= $3::timestamptz`,
        [
          address.toLowerCase(),
          suppressed ? 'suppressed' : 'unsubscribed',
          event.created_at,
        ],
      );
    }
  });
}
