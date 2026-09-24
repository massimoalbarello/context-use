export function passkeyConfiguration({
  baseUrl,
  nibrunHostname,
}: {
  baseUrl: URL;
  nibrunHostname?: string;
}) {
  // Credentials retain nibrun's original RP ID when a custom public origin changes.
  const relyingPartyUrl = nibrunHostname ? new URL(`https://${nibrunHostname}`) : baseUrl;
  return {
    rpID: relyingPartyUrl.hostname,
    origins: [...new Set([relyingPartyUrl.origin, baseUrl.origin])],
  };
}
