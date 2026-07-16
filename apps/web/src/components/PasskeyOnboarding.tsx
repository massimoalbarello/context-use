import { useState } from "react";
import { authClient } from "../auth-client.ts";

export function PasskeyOnboarding({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const register = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await authClient.passkey.addPasskey({ name: "Publication passkey" });
      if (result.error) setError(result.error.message ?? "Passkey registration failed");
      else onComplete();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Passkey registration failed");
    } finally {
      setWorking(false);
    }
  };

  return <main className="center-card wide">
    <span className="eyebrow">Security setup</span>
    <h1>Create your publication passkey</h1>
    <p>Pages and assets cannot be made public without a fresh biometric, device PIN, or hardware security-key confirmation.</p>
    <div className="security-callout">
      <strong>This is the only passkey this installation will accept.</strong>
      <span>It cannot be replaced or recovered. Store it in a synced credential manager or use a durable authenticator you expect to keep.</span>
    </div>
    {error && <p className="error">{error}</p>}
    <button className="primary" disabled={working} onClick={register}>{working ? "Waiting for your device…" : "Create passkey"}</button>
  </main>;
}
