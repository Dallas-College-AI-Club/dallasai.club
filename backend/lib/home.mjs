// The Home page: what needs an officer this week, read in one request.
// Member names appear only on the newest New submissions, as in the Inbox.
// Recent activity is officers' own actions with labels: no member names,
// emails, comment bodies or entry data.
const preview = (data) => {
  const text = [data?.subject, data?.topic, data?.title, data?.campus].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return text ? text.trim().slice(0, 120) : '';
};
export async function homeSummary(db, published, upcoming) {
  const upcomingIds = upcoming.map((event) => event.id);
  const titles = new Map(published.map((event) => [event.id, event]));
  // New RSVPs per event; cancelled RSVPs are not counted.
  const rsvpGroups = (
    await db.query(
      `SELECT data->>'eventId' AS id,
        (array_agg(data->>'eventTitle' ORDER BY created_at DESC))[1] AS title,
        (array_agg(data->>'eventDate' ORDER BY created_at DESC))[1] AS date,
        count(*)::int AS total,
        count(*) FILTER (WHERE review_status='new')::int AS new
      FROM club_forms.entries WHERE kind='rsvp' AND state<>'cancelled' AND data->>'eventId' IS NOT NULL
      GROUP BY 1 HAVING count(*) FILTER (WHERE review_status='new')>0`,
    )
  ).rows
    .map((group) => ({
      ...group,
      title: titles.get(group.id)?.title || group.title,
      date: titles.get(group.id)?.date || group.date,
      past: !upcomingIds.includes(group.id),
    }))
    .sort(
      (a, b) =>
        Number(a.past) - Number(b.past) ||
        (a.date || '').localeCompare(b.date || ''),
    );
  const newest = (
    await db.query(
      `SELECT id,kind,name,email,created_at,review_status,data FROM club_forms.entries
      WHERE review_status='new' AND kind<>'rsvp' ORDER BY created_at DESC,id LIMIT 5`,
    )
  ).rows.map(({ data, ...entry }) => ({ ...entry, preview: preview(data) }));
  const dated = upcoming.find((event) => event.date);
  const nextEvent = dated
    ? {
        id: dated.id,
        title: dated.title,
        date: dated.date,
        category: dated.category || '',
        rsvps: (
          await db.query(
            `SELECT count(*)::int AS n FROM club_forms.entries WHERE kind='rsvp' AND state<>'cancelled' AND data->>'eventId'=$1`,
            [dated.id],
          )
        ).rows[0].n,
      }
    : null;
  const potential = upcoming
    .filter((event) => !event.date)
    .map(({ id, title }) => ({ id, title }));
  const unpublished = (
    await db.query(
      `SELECT id,draft->>'title' AS title,draft->>'date' AS date,
        (draft->>'potential')='true' AS potential,published IS NOT NULL AS live
      FROM club_forms.events WHERE archived_at IS NULL AND (published IS NULL OR revision<>published_revision)
      ORDER BY updated_at DESC,id LIMIT 6`,
    )
  ).rows;
  const survey =
    (
      await db.query(
        `SELECT s.id,s.title,s.expires_at,
          count(r.advisor_id) FILTER (WHERE m.active AND jsonb_array_length(r.responses)>0)::int AS responses,
          max(r.submitted_at) FILTER (WHERE m.active AND jsonb_array_length(r.responses)>0) AS latest
        FROM club_forms.custom_surveys s
        LEFT JOIN club_forms.custom_survey_members m ON m.survey_id=s.id
        LEFT JOIN club_forms.custom_survey_responses r ON r.survey_id=m.survey_id AND r.advisor_id=m.advisor_id
        WHERE s.status='open' AND s.expires_at>now()
        GROUP BY s.id ORDER BY s.created_at DESC,s.id LIMIT 1`,
      )
    ).rows[0] || null;
  // Officer actions only. Submission actions name the kind, never the person.
  const activity = (
    await db.query(
      `(SELECT a.actor,a.action,a.created_at,e.kind AS label,'entry' AS source
        FROM club_forms.audit a LEFT JOIN club_forms.entries e ON e.id=a.entry_id
        WHERE a.actor LIKE '%@%' ORDER BY a.id DESC LIMIT 8)
      UNION ALL
      (SELECT h.actor,h.action,h.created_at,coalesce(v.draft->>'title',h.event_id) AS label,'event' AS source
        FROM club_forms.event_history h LEFT JOIN club_forms.events v ON v.id=h.event_id
        ORDER BY h.id DESC LIMIT 8)
      UNION ALL
      (SELECT c.actor_email,c.action,c.created_at,s.title AS label,'survey' AS source
        FROM club_forms.custom_survey_changes c JOIN club_forms.custom_surveys s ON s.id=c.survey_id
        ORDER BY c.created_at DESC LIMIT 8)
      ORDER BY created_at DESC LIMIT 8`,
    )
  ).rows;
  return {
    rsvpGroups,
    newest,
    nextEvent,
    potential,
    unpublished,
    survey,
    activity,
  };
}
