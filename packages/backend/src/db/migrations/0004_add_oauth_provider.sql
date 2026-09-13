create table "auth_jwks" (
  "id" text not null primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" date not null,
  "expiresAt" date,
  "alg" text,
  "crv" text
);

create table "auth_oauthClient" (
  "id" text not null primary key,
  "clientId" text not null unique,
  "clientSecret" text,
  "clientDiscoveryId" text,
  "disabled" integer default 0,
  "skipConsent" integer,
  "enableEndSession" integer,
  "subjectType" text,
  "scopes" text,
  "clientCredentialsScopes" text default '[]',
  "userId" text references "auth_user" ("id"),
  "createdAt" date,
  "updatedAt" date,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text,
  "tos" text,
  "policy" text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" text not null,
  "postLogoutRedirectUris" text,
  "backchannelLogoutUri" text,
  "backchannelLogoutSessionRequired" integer,
  "tokenEndpointAuthMethod" text,
  "applicationType" text,
  "jwks" text,
  "jwksUri" text,
  "grantTypes" text,
  "responseTypes" text,
  "requirePKCE" integer,
  "dpopBoundAccessTokens" integer default 0,
  "referenceId" text,
  "metadata" text
);

create index "auth_oauthClient_userId_idx" on "auth_oauthClient" ("userId");

create table "auth_oauthResource" (
  "id" text not null primary key,
  "identifier" text not null unique,
  "name" text not null,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" text,
  "customClaims" text,
  "dpopBoundAccessTokensRequired" integer default 0,
  "disabled" integer default 0,
  "createdAt" date,
  "updatedAt" date,
  "policyVersion" integer default 1,
  "metadata" text
);

create table "auth_oauthClientResource" (
  "id" text not null primary key,
  "clientId" text not null references "auth_oauthClient" ("clientId") on delete cascade,
  "resourceId" text not null references "auth_oauthResource" ("identifier") on delete cascade,
  "metadata" text,
  "createdAt" date
);

create index "auth_oauthClientResource_clientId_idx"
  on "auth_oauthClientResource" ("clientId");
create index "auth_oauthClientResource_resourceId_idx"
  on "auth_oauthClientResource" ("resourceId");
create unique index "auth_oauthClientResource_clientId_resourceId_uidx"
  on "auth_oauthClientResource" ("clientId", "resourceId");

create table "auth_oauthRefreshToken" (
  "id" text not null primary key,
  "token" text not null unique,
  "clientId" text not null references "auth_oauthClient" ("clientId"),
  "sessionId" text references "auth_session" ("id") on delete set null,
  "userId" text not null references "auth_user" ("id"),
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "expiresAt" date not null,
  "createdAt" date not null,
  "revoked" date,
  "rotatedAt" date,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" date,
  "authTime" date,
  "confirmation" text,
  "scopes" text not null
);

create index "auth_oauthRefreshToken_clientId_idx" on "auth_oauthRefreshToken" ("clientId");
create index "auth_oauthRefreshToken_sessionId_idx" on "auth_oauthRefreshToken" ("sessionId");
create index "auth_oauthRefreshToken_userId_idx" on "auth_oauthRefreshToken" ("userId");
create index "auth_oauthRefreshToken_authorizationCodeId_idx"
  on "auth_oauthRefreshToken" ("authorizationCodeId");

create table "auth_oauthAccessToken" (
  "id" text not null primary key,
  "token" text unique,
  "clientId" text not null references "auth_oauthClient" ("clientId"),
  "sessionId" text references "auth_session" ("id") on delete set null,
  "userId" text references "auth_user" ("id"),
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "refreshId" text references "auth_oauthRefreshToken" ("id"),
  "expiresAt" date not null,
  "createdAt" date not null,
  "revoked" date,
  "confirmation" text,
  "scopes" text not null
);

create index "auth_oauthAccessToken_clientId_idx" on "auth_oauthAccessToken" ("clientId");
create index "auth_oauthAccessToken_sessionId_idx" on "auth_oauthAccessToken" ("sessionId");
create index "auth_oauthAccessToken_userId_idx" on "auth_oauthAccessToken" ("userId");
create index "auth_oauthAccessToken_authorizationCodeId_idx"
  on "auth_oauthAccessToken" ("authorizationCodeId");
create index "auth_oauthAccessToken_refreshId_idx" on "auth_oauthAccessToken" ("refreshId");

create table "auth_oauthConsent" (
  "id" text not null primary key,
  "clientId" text not null references "auth_oauthClient" ("clientId"),
  "userId" text references "auth_user" ("id"),
  "referenceId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "scopes" text not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "auth_oauthConsent_clientId_idx" on "auth_oauthConsent" ("clientId");
create index "auth_oauthConsent_userId_idx" on "auth_oauthConsent" ("userId");

create table "auth_oauthClientAssertion" (
  "id" text not null primary key,
  "expiresAt" date not null
);
