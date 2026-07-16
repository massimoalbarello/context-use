import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "../auth-client.ts";

export function Login() {
  const [setupToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("setup") ?? "");
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (window.location.hash) history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  const signIn = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) setError(result.error.message ?? "Passkey sign-in failed");
      else window.location.assign("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey sign-in failed");
    } finally {
      setWorking(false);
    }
  };

  const enroll = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const result = await authClient.passkey.addPasskey({
        name: "Owner passkey",
        context: JSON.stringify({ email, token: setupToken }),
      });
      if (result.error) {
        setError(result.error.message ?? "Passkey setup failed");
        return;
      }
      const signedIn = await authClient.signIn.passkey();
      if (signedIn.error) setError("Your passkey was created. Reload this page and use Sign in with passkey.");
      else window.location.assign("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey setup failed");
    } finally {
      setWorking(false);
    }
  };

  return <main className="center-card">
    <div className="brand-mark">cu</div>
    <h1>context-use</h1>
    <p>Your private knowledge base.</p>
    {setupToken ? <form className="login-form" onSubmit={enroll}>
      <span className="eyebrow">Owner setup</span>
      <p>Enter the owner email chosen during deployment, then create the installation's only passkey. Your device will ask once more to sign in.</p>
      <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <div className="security-callout"><strong>This passkey is permanent.</strong><span>It is the only way to sign in or change public visibility. It cannot be replaced or recovered.</span></div>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={working} type="submit">{working ? "Waiting for your device…" : "Create owner passkey"}</button>
    </form> : <>
      <p>Use the owner passkey to sign in. Email is not an authentication method.</p>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={working} onClick={signIn}>{working ? "Waiting for your device…" : "Sign in with passkey"}</button>
    </>}
  </main>;
}
