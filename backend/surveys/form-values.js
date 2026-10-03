// Check the value itself: a person's answer may literally be "Not answered".
export function hasAnswer(value) {
  return (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.trim().length > 0) &&
    (!Array.isArray(value) || value.length > 0)
  );
}
