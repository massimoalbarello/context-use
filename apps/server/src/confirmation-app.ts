import { ConfirmationRepository, createPool, type ConfirmationPasskey } from "@context-use/database";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { Elysia } from "elysia";
import { z } from "zod";
import { config } from "./config.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { hasInternalCapability } from "./internal-capability.ts";
import { securityHeaders } from "./security.ts";

const pool = createPool(config.CONFIRMATION_DATABASE_URL, { application_name: "context-use-confirmation" });
const confirmations = new ConfirmationRepository(pool);
const ownerUserId = "context-use-owner";

const confirmSchema = z.object({
  intent_id: z.string().uuid(),
  response: z.custom<AuthenticationResponseJSON>((value) => Boolean(value && typeof value === "object")),
}).strict();
const claimSchema = z.object({
  owner_user_id: z.literal(ownerUserId),
  session_id: z.string().min(1).max(512),
}).strict();
const browserConfirmationSchema = z.object({
  principal: claimSchema,
  confirmation: confirmSchema,
}).strict();

function transports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  const parsed = value?.split(",").filter(Boolean) as AuthenticatorTransportFuture[] | undefined;
  return parsed?.length ? parsed : undefined;
}

async function optionsFor(kind: "publication" | "knowledge_export", intentId: string) {
  const passkeys = await confirmations.passkeys(ownerUserId);
  if (!passkeys.length) return null;
  const options = await generateAuthenticationOptions({
    rpID: config.WEBAUTHN_RP_ID,
    userVerification: "required",
    timeout: 300_000,
    allowCredentials: passkeys.map((key) => {
      const keyTransports = transports(key.transports);
      return { id: key.credentialID, ...(keyTransports ? { transports: keyTransports } : {}) };
    }),
  });
  await confirmations.issueChallenge(kind, intentId, options.challenge);
  return options;
}

async function verifiedPasskey(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<{ key: ConfirmationPasskey; newCounter: number } | null> {
  const key = (await confirmations.passkeys(ownerUserId)).find((candidate) => candidate.credentialID === response.id);
  if (!key) return null;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.APP_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      credential: {
        id: key.credentialID,
        publicKey: Buffer.from(key.publicKey, "base64"),
        counter: key.counter,
        ...(() => {
          const keyTransports = transports(key.transports);
          return keyTransports ? { transports: keyTransports } : {};
        })(),
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) return null;
    return { key, newCounter: verification.authenticationInfo.newCounter };
  } catch {
    return null;
  }
}

export const confirmationApp = new Elysia()
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "confirmation" }))
  .post("/internal/confirmation/:kind/:id/options", async ({ request, params }) => {
    if (!hasInternalCapability(request, config.CONFIRMATION_DASHBOARD_TOKEN)) return problem("Not found", 404, "not_found");
    const kind = z.enum(["publication", "knowledge_export"]).parse(params.kind);
    const intentId = z.string().uuid().parse(params.id);
    const options = await optionsFor(kind, intentId);
    return options ? json(options) : problem("Register a passkey before confirming", 409, "passkey_required");
  })
  .post("/internal/knowledge-exports/:id/claim", async ({ request, params }) => {
    if (!hasInternalCapability(request, config.CONFIRMATION_DASHBOARD_TOKEN)) return problem("Not found", 404, "not_found");
    const principal = claimSchema.parse(await bodyJson(request));
    await confirmations.claimExport(z.string().uuid().parse(params.id), {
      ownerUserId: principal.owner_user_id,
      sessionId: principal.session_id,
    });
    return new Response(null, { status: 204 });
  })
  .post("/internal/browser-confirmation/publication", async ({ request }) => {
    if (!hasInternalCapability(request, config.CONFIRMATION_GATEWAY_TOKEN)) return problem("Not found", 404, "not_found");
    const input = browserConfirmationSchema.parse(await bodyJson(request));
    const principal = {
      userId: input.principal.owner_user_id,
      sessionId: input.principal.session_id,
    };
    const intent = await confirmations.publicationIntent(input.confirmation.intent_id);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Publication intent not found", 404, "not_found");
    }
    if (!intent.challenge || intent.consumed_at || new Date(intent.expires_at).getTime()<=Date.now()) {
      return problem("Publication intent is inactive", 409, "intent_inactive");
    }
    const verified = await verifiedPasskey(input.confirmation.response, intent.challenge);
    if (!verified) return problem("Passkey verification failed", 403, "passkey_invalid");
    await confirmations.confirmPublication(intent.id, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    }, {
      credentialId: verified.key.credentialID,
      expectedCounter: verified.key.counter,
      newCounter: verified.newCounter,
    });
    return json({
      published: intent.action !== "unpublish",
      action: intent.action,
      target_kind: intent.target_kind,
      target_id: intent.target_id,
    });
  })
  .post("/internal/browser-confirmation/knowledge_export", async ({ request }) => {
    if (!hasInternalCapability(request, config.CONFIRMATION_GATEWAY_TOKEN)) return problem("Not found", 404, "not_found");
    const input = browserConfirmationSchema.parse(await bodyJson(request));
    const principal = {
      userId: input.principal.owner_user_id,
      sessionId: input.principal.session_id,
    };
    const intent = await confirmations.exportIntent(input.confirmation.intent_id);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge export intent not found", 404, "not_found");
    }
    if (!intent.challenge || intent.confirmed_at || intent.download_started_at
        || new Date(intent.expires_at).getTime()<=Date.now()) {
      return problem("Knowledge export intent is inactive", 409, "intent_inactive");
    }
    const verified = await verifiedPasskey(input.confirmation.response, intent.challenge);
    if (!verified) return problem("Passkey verification failed", 403, "passkey_invalid");
    await confirmations.confirmExport(intent.id, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    }, {
      credentialId: verified.key.credentialID,
      expectedCounter: verified.key.counter,
      newCounter: verified.newCounter,
    });
    return json({
      download_url: `/api/dashboard/knowledge-exports/${encodeURIComponent(intent.id)}/download`,
    });
  });
