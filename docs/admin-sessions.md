# Admin sign-in duration

An approved officer stays signed in on the same browser for three days (72 hours)
from a successful email-code sign-in. Closing and reopening the browser preserves
the login. Signing out, clearing browser cookies, or revoking officer access ends
it sooner. Private browsing can discard the login when its window closes.

The club enforces this window from the verified Neon session's createdAt timestamp.
Neon's longer or renewed expiry never extends the club's deadline. Each admin API
request still verifies the upstream session, current admin role, and officer email
allowlist. Browser session lookup applies the same deadline and clears expired
login cookies. Session tokens stay in secure, HTTP-only cookies; they are not
stored in browser local storage. Short-lived session-cache cookies keep their own
expiry and are never used instead of upstream authorization.

The managed Neon session lifetime must remain at least 72 hours. The current
installation uses seven-day upstream sessions; no database or Neon configuration
change is required. The retained legacy password fallback also uses a three-day
session with rolling renewal disabled.

Tests cover returning after 71 hours, expiration at 72 hours, upstream renewals,
persistent browser cookie attributes, logout, and revoked access.
