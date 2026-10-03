export const emailList = (value) =>
  (value || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
