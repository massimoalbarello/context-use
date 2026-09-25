import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { passkeyConfiguration } from '#backend/lib/auth/passkey-configuration.ts';
import type {
  PublicationPreparation,
  PublicationResource,
} from '#backend/models/publications/model.ts';
import type {
  PublicationApprovalResult,
  PublicationApprovalsRepositoryContract,
} from '#backend/repositories/publications/approvals.ts';
import type {
  PublicationRequest,
  PublicationsRepositoryContract,
} from '#backend/repositories/publications/repository.ts';

export type PublicationApprovalBeginResult =
  | {
      state: 'ready';
      approvalId: string;
      expiresAt: string;
      preparation: PublicationPreparation;
      options: PublicKeyCredentialRequestOptionsJSON;
    }
  | { state: 'blocked'; blockers: PublicationPreparation['blockers'] }
  | { state: 'not_found' | 'approval_invalid' | 'passkey_required' };

export type PublicationApprovalCompleteResult =
  | PublicationApprovalResult
  | { state: 'assertion_invalid' };

export class PublicationApprovalService {
  private readonly publications: PublicationsRepositoryContract;
  private readonly approvals: PublicationApprovalsRepositoryContract;
  private readonly passkeys: ReturnType<typeof passkeyConfiguration>;
  private readonly now: () => Date;

  constructor({
    publications,
    approvals,
    passkeys,
    now = () => new Date(),
  }: {
    publications: PublicationsRepositoryContract;
    approvals: PublicationApprovalsRepositoryContract;
    passkeys: ReturnType<typeof passkeyConfiguration>;
    now?: () => Date;
  }) {
    this.publications = publications;
    this.approvals = approvals;
    this.passkeys = passkeys;
    this.now = now;
  }

  async status(input: {
    ownerId: string;
    readableId: string;
    resourceType: PublicationResource['resourceType'];
  }) {
    if (input.resourceType === 'page') {
      const publication = await this.publications.pageStatus(input);
      return publication ? { resourceType: 'page' as const, ...publication } : null;
    }
    const publication =
      input.resourceType === 'entity'
        ? await this.publications.entityStatus(input)
        : input.resourceType === 'record'
          ? await this.publications.recordStatus(input)
          : await this.publications.assetStatus(input);
    return publication ? { resourceType: input.resourceType, ...publication } : null;
  }

  async begin({
    request,
    sessionId,
  }: {
    request: PublicationRequest;
    sessionId: string;
  }): Promise<PublicationApprovalBeginResult> {
    const preparation = await this.publications.prepare(request);
    if (!preparation) {
      return { state: 'not_found' };
    }
    if (preparation.blockers.length) {
      return { state: 'blocked', blockers: preparation.blockers };
    }
    const credentials = await this.approvals.credentials({ ownerId: request.ownerId });
    if (!credentials.length) {
      return { state: 'passkey_required' };
    }
    const options = await generateAuthenticationOptions({
      rpID: this.passkeys.rpID,
      userVerification: 'required',
      allowCredentials: credentials.map((credential) => ({ id: credential.credentialId })),
    });
    const approval = await this.approvals.create({
      request,
      sessionId,
      challenge: options.challenge,
      expectedState: preparation.expectedState,
      now: this.now().toISOString(),
    });
    return approval
      ? {
          state: 'ready',
          approvalId: approval.id,
          expiresAt: approval.expiresAt,
          preparation,
          options,
        }
      : { state: 'approval_invalid' };
  }

  async complete({
    ownerId,
    sessionId,
    approvalId,
    assertion,
  }: {
    ownerId: string;
    sessionId: string;
    approvalId: string;
    assertion: AuthenticationResponseJSON;
  }): Promise<PublicationApprovalCompleteResult> {
    const identity = { ownerId, sessionId, approvalId };
    const approval = await this.approvals.find({ ...identity, now: this.now().toISOString() });
    if (!approval) {
      return { state: 'approval_invalid' };
    }
    const credentials = await this.approvals.credentials({ ownerId });
    const credential = credentials.find((candidate) => candidate.credentialId === assertion.id);
    if (!credential) {
      return { state: 'assertion_invalid' };
    }
    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: approval.challenge,
        expectedOrigin: this.passkeys.origins,
        expectedRPID: this.passkeys.rpID,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64'),
          counter: credential.counter,
        },
        requireUserVerification: true,
      });
    } catch {
      return { state: 'assertion_invalid' };
    }
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      return { state: 'assertion_invalid' };
    }
    return this.approvals.completeVerifiedApproval({
      ...identity,
      credential,
      newCounter: verification.authenticationInfo.newCounter,
      now: this.now().toISOString(),
    });
  }
}

export type PublicationApprovalServiceContract = Pick<
  PublicationApprovalService,
  'begin' | 'complete' | 'status'
>;
