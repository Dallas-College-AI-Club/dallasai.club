// One read-only source keeps survey responses in the same Inbox pages/counts.
export const inboxSource = `WITH inbox_rows AS (
  SELECT (jsonb_populate_record(NULL::club_forms.entries,to_jsonb(e) ||
    CASE WHEN e.kind='rsvp' AND v.rsvp_survey_status<>'active'
      THEN jsonb_build_object('review_status','closed','data',e.data || jsonb_build_object('rsvpSurveyArchived',true))
      ELSE '{}'::jsonb END)).*,'entry'::text AS source
  FROM club_forms.entries e
  LEFT JOIN club_forms.survey_responses sr ON e.kind='rsvp' AND sr.entry_id=e.id
  LEFT JOIN club_forms.events v ON e.kind='rsvp' AND v.id=coalesce(sr.event_id,e.data->>'eventId')
  UNION ALL
  SELECT (jsonb_populate_record(NULL::club_forms.entries,jsonb_build_object(
    'id',overlay(overlay(md5('custom-survey:'||s.id::text||':'||m.advisor_id) placing '4' from 13) placing '8' from 17)::uuid,
    'kind',CASE WHEN s.definition->>'eventId' IS NOT NULL THEN 'feedback' ELSE 'survey' END,
    'name',m.display_name,'email',m.email,'state','active',
    'review_status',CASE WHEN NOT m.active OR s.status='archived' THEN 'closed' ELSE 'new' END,
    'created_at',r.submitted_at,'updated_at',r.submitted_at,'edit_revision',0,
    'data',jsonb_build_object('title',s.title,'surveyId',s.id,'advisorId',m.advisor_id,
      'eventId',s.definition->>'eventId','expiresAt',s.expires_at,'memberActive',m.active,'surveyArchived',s.status='archived')
  ))).*,'custom-survey'::text AS source
  FROM club_forms.custom_surveys s
  JOIN club_forms.custom_survey_members m ON m.survey_id=s.id
  JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id)
  WHERE (jsonb_array_length(r.responses)>0 OR coalesce(r.response_definition,s.definition) IS NOT NULL)
)`;

export const currentInbox = (upcoming = '$5', recentEvents = '$6') => `CASE
  WHEN e.kind='rsvp' THEN coalesce(e.data->>'eventId','')=ANY(${upcoming}::text[])
  WHEN e.kind='feedback' THEN coalesce(e.data->>'eventId','')=ANY(${recentEvents}::text[])
  WHEN e.kind='survey' THEN (e.data->>'expiresAt')::timestamptz>now() OR e.created_at>=now()-interval '14 days'
  ELSE e.created_at>=now()-interval '14 days' END`;

export const inboxCountsQuery = `${inboxSource}
  SELECT CASE WHEN e.kind='rsvp' AND NOT(coalesce(e.data->>'eventId','')=ANY($1::text[])) THEN 'rsvp-past' ELSE e.kind END AS kind,
    count(*)::int AS total,
    count(*) FILTER (WHERE e.review_status<>'closed' AND e.created_at>=now()-interval '14 days')::int AS new,
    count(*) FILTER (WHERE e.review_status<>'closed' AND ${currentInbox('$1', '$2')})::int AS current,
    count(*) FILTER (WHERE e.review_status<>'closed' AND NOT(${currentInbox('$1', '$2')}))::int AS past,
    count(*) FILTER (WHERE e.review_status='closed')::int AS closed,
    0::int AS reviewed,max(e.created_at) AS latest FROM inbox_rows e GROUP BY 1`;
