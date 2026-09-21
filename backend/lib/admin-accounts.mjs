import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { email as validateEmail } from './validation.mjs';
export const emailList = (value) =>
  (value || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
// This helper is used by a private command, never a public signup route.
export async function createAdmin(
  tx,
  { email, name, password },
  allowedEmails,
) {
  email = validateEmail(email);
  if (!emailList(allowedEmails).includes(email))
    throw new Error('Officer email is not approved.');
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error('Use a password between 12 and 128 characters.');
  const exists = await tx.query(
    'SELECT id FROM public.club_admin_user WHERE email=$1',
    [email],
  );
  if (exists.rows.length)
    throw new Error(
      'Officer account already exists; existing credentials were not changed.',
    );
  const id = randomUUID();
  const hash = await hashPassword(password);
  await tx.query(
    'INSERT INTO public.club_admin_user(id,name,email,"emailVerified","updatedAt") VALUES($1,$2,$3,false,now())',
    [id, name || email, email],
  );
  await tx.query(
    'INSERT INTO public.club_admin_account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,$3,now())',
    [randomUUID(), id, hash],
  );
  return { id, email };
}
