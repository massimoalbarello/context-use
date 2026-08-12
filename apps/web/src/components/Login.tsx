import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "../auth-client.ts";
import {
  continuesOAuthAuthorization,
  establishedSession,
  failureMessage,
  thrownFailureMessage,
} from "../login-feedback.ts";

export function Login() {
  const [entry] = useState(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    return {
      setupToken: parameters.get("setup") ?? "",
      enrollmentClaim: parameters.get("enroll") ?? "",
    };
  });
  const [email, setEmail] = useState("");
  const [passkeyName, setPasskeyName] = useState("Primary passkey");
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
      if (result.error) setError(failureMessage(result.error, "Sign-in failed. Try again."));
      else if (continuesOAuthAuthorization(result.data)) return;
      else if (!establishedSession(result.data)) setError("Your passkey was accepted, but no session was created. Try again.");
      else window.location.assign("/app");
    } catch (cause) {
      setError(thrownFailureMessage(cause, "Sign-in could not reach this installation. Check that it is running and try again."));
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
        name: passkeyName,
        context: JSON.stringify({ email, token: entry.setupToken }),
      });
      if (result.error) {
        setError(failureMessage(result.error, "Creating the passkey failed. Try again."));
        return;
      }
      const signedIn = await authClient.signIn.passkey();
      if (signedIn.error) setError(`Your passkey was created. ${failureMessage(signedIn.error, "Signing in with it failed.")} Reload this page and use Sign in with passkey.`);
      else if (continuesOAuthAuthorization(signedIn.data)) return;
      else if (!establishedSession(signedIn.data)) setError("Your passkey was created but no session was started. Reload this page and use Sign in with passkey.");
      else window.location.assign("/app");
    } catch (cause) {
      setError(thrownFailureMessage(cause, "Passkey setup could not reach this installation. Check that it is running and try again."));
    } finally {
      setWorking(false);
    }
  };

  const enrollAdditional = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await authClient.passkey.addPasskey({
        context: JSON.stringify({ enrollment_claim: entry.enrollmentClaim }),
      });
      if (result.error) {
        setError(failureMessage(result.error, "Creating the passkey failed. Try again."));
        return;
      }
      const signedIn = await authClient.signIn.passkey();
      if (signedIn.error) setError(`Your passkey was created. ${failureMessage(signedIn.error, "Signing in with it failed.")} Reload this page and sign in with it.`);
      else if (continuesOAuthAuthorization(signedIn.data)) return;
      else if (!establishedSession(signedIn.data)) setError("Your passkey was created but no session was started. Reload this page and sign in with it.");
      else window.location.assign("/app/settings");
    } catch (cause) {
      setError(thrownFailureMessage(cause, "Passkey setup could not reach this installation. Check that it is running and try again."));
    } finally {
      setWorking(false);
    }
  };

  return <main className="center-card">
    <div className="brand-mark">cu</div>
    <h1>context-use</h1>
    <p>Your private knowledge base.</p>
    {entry.setupToken ? <form className="login-form" onSubmit={enroll}>
      <span className="eyebrow">Owner setup</span>
      <p>Enter the owner email chosen during deployment, name this passkey, and create it. Your device will ask once more to sign in.</p>
      <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Passkey name<input required maxLength={80} value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} /></label>
      <div className="security-callout"><strong>This is your initial passkey.</strong><span>Additional passkeys can only be authorized later from Dashboard Settings.</span></div>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={working} type="submit">{working ? "Waiting for your device…" : "Create owner passkey"}</button>
    </form> : entry.enrollmentClaim ? <div className="login-form">
      <span className="eyebrow">Passkey enrollment</span>
      <p>Create the passkey authorized from Context Use Settings. This invitation expires after five minutes and can only be used once.</p>
      <div className="security-callout"><strong>Use this device’s authenticator.</strong><span>Your browser will let you choose an available passkey provider.</span></div>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={working} onClick={enrollAdditional}>{working ? "Waiting for your device…" : "Create passkey"}</button>
    </div> : <>
      <p>Use the owner passkey to sign in. Email is not an authentication method.</p>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={working} onClick={signIn}>{working ? "Waiting for your device…" : "Sign in with passkey"}</button>
    </>}
  </main>;
}
