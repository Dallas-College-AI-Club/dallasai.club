// Device tokens are authentication state, not respondent answers or audit history.
// Bound each run so a backlog cannot monopolize the daily maintenance job.
export async function cleanupSurveyDevices(db) {
  const { rows } = await db.query(`
    DELETE FROM club_forms.custom_survey_devices WHERE token_digest IN (
      SELECT token_digest FROM club_forms.custom_survey_devices
      WHERE expires_at<=now() OR revoked_at IS NOT NULL
      ORDER BY expires_at LIMIT 1000
    ) RETURNING token_digest`);
  return rows.length;
}
