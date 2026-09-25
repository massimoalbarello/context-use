import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { cose, isoCBOR } from '@simplewebauthn/server/helpers';

const CREDENTIAL_ID_BYTES = 32;
const COUNTER_BYTES = 4;
const AAGUID_BYTES = 16;
const CREDENTIAL_LENGTH_BYTES = 2;
const REGISTRATION_FLAGS = 0x45;
const AUTHENTICATION_FLAGS = 0x05;

function hash(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

// A test authenticator emits real, signed WebAuthn messages. Only the device is simulated;
// The server verifies the origin, RP hash, challenge, user verification and database state.
export function testPasskey(rpId: string) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = keys.publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(CREDENTIAL_ID_BYTES);
  const id = credentialId.toString('base64url');
  let counter = 0;
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
      [cose.COSEKEYS.alg, cose.COSEALG.ES256],
      [cose.COSEKEYS.crv, cose.COSECRV.P256],
      [cose.COSEKEYS.x, Buffer.from(publicKey.x!, 'base64url')],
      [cose.COSEKEYS.y, Buffer.from(publicKey.y!, 'base64url')],
    ]),
  );
  function authenticatorData(flags: number) {
    const counterBytes = Buffer.alloc(COUNTER_BYTES);
    counterBytes.writeUInt32BE(counter++);
    return Buffer.concat([hash(rpId), Buffer.from([flags]), counterBytes]);
  }
  function clientData({
    type,
    origin,
    challenge,
  }: {
    type: string;
    origin: string;
    challenge: string;
  }) {
    return Buffer.from(JSON.stringify({ type, origin, challenge }));
  }
  return {
    id,
    publicKey: Buffer.from(coseKey).toString('base64'),
    registration({ origin, challenge }: { origin: string; challenge: string }) {
      const length = Buffer.alloc(CREDENTIAL_LENGTH_BYTES);
      length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        authenticatorData(REGISTRATION_FLAGS), // User present, user verified, attested credential included.
        Buffer.alloc(AAGUID_BYTES),
        length,
        credentialId,
        coseKey,
      ]);
      const attestation = isoCBOR.encode(
        new Map<string, string | Map<string, never> | Uint8Array>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, never>()],
          ['authData', authData],
        ]),
      );
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: clientData({ type: 'webauthn.create', origin, challenge }).toString(
            'base64url',
          ),
          attestationObject: Buffer.from(attestation).toString('base64url'),
          transports: ['internal'],
        },
        clientExtensionResults: {},
      };
    },
    authentication({
      origin,
      challenge,
      flags = AUTHENTICATION_FLAGS,
    }: {
      origin: string;
      challenge: string;
      flags?: number;
    }): AuthenticationResponseJSON {
      const data = clientData({ type: 'webauthn.get', origin, challenge });
      const authData = authenticatorData(flags);
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: data.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: sign(
            'sha256',
            Buffer.concat([authData, hash(data)]),
            keys.privateKey,
          ).toString('base64url'),
        },
        clientExtensionResults: {},
      };
    },
  };
}
