-- Generated from the pinned Better Auth configuration; no member passwords.
BEGIN;
create table "club_admin_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "club_admin_session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "club_admin_user" ("id") on delete cascade);

create table "club_admin_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "club_admin_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "club_admin_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "club_admin_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "club_admin_session_userId_idx" on "club_admin_session" ("userId");

create index "club_admin_account_userId_idx" on "club_admin_account" ("userId");

create index "club_admin_verification_identifier_idx" on "club_admin_verification" ("identifier");
COMMIT;
