ALTER TABLE "oauthClient"
  ADD COLUMN "dpopBoundAccessTokens" boolean NOT NULL DEFAULT false;

CREATE TABLE "oauthResource" (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" jsonb,
  "customClaims" jsonb,
  "dpopBoundAccessTokensRequired" boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "policyVersion" integer NOT NULL DEFAULT 1,
  metadata jsonb
);

CREATE TABLE "oauthClientResource" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "resourceId" text NOT NULL REFERENCES "oauthResource"(identifier) ON DELETE CASCADE,
  metadata jsonb,
  "createdAt" timestamptz
);
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

ALTER TABLE "oauthRefreshToken"
  ADD COLUMN "authorizationCodeId" text,
  ADD COLUMN resources jsonb,
  ADD COLUMN "requestedUserInfoClaims" jsonb,
  ADD COLUMN "rotatedAt" timestamptz,
  ADD COLUMN "rotationReplayResponse" text,
  ADD COLUMN "rotationReplayExpiresAt" timestamptz,
  ADD COLUMN confirmation jsonb;
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

ALTER TABLE "oauthAccessToken"
  ADD COLUMN "authorizationCodeId" text,
  ADD COLUMN resources jsonb,
  ADD COLUMN "requestedUserInfoClaims" jsonb,
  ADD COLUMN revoked timestamptz,
  ADD COLUMN confirmation jsonb;
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

ALTER TABLE "oauthConsent"
  ADD COLUMN resources jsonb,
  ADD COLUMN "requestedUserInfoClaims" jsonb;

CREATE TABLE "oauthClientAssertion" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL
);

REVOKE ALL ON "oauthResource", "oauthClientResource", "oauthClientAssertion" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "oauthResource", "oauthClientResource", "oauthClientAssertion" TO context_use_auth;
GRANT SELECT ON "oauthResource", "oauthClientResource", "oauthClientAssertion" TO context_use_backup;
