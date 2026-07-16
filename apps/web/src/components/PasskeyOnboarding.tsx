import { useState } from "react";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";

export function PasskeyOnboarding({ onComplete, recoveryToken }: { onComplete: () => void; recoveryToken?: string }) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [recoveryConsumed, setRecoveryConsumed] = useState(false);

  const register = async () => {
    setWorking(true);
    setError("");
    try {
      if (recoveryToken && !recoveryConsumed) {
        await api("/api/dashboard/passkey-recovery/consume", { method: "POST", body: JSON.stringify({ token: recoveryToken }) });
        setRecoveryConsumed(true);
        history.replaceState({}, "", "/app");
      }
      const result = await authClient.passkey.addPasskey({ name: recoveryToken ? "Recovered publication passkey" : "Publication passkey" });
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
      <strong>The private key stays on your device.</strong>
      <span>context-use stores only the public credential. Add a second recovery passkey after onboarding.</span>
    </div>
    {error && <p className="error">{error}</p>}
    <button className="primary" disabled={working} onClick={register}>{working ? "Waiting for your device…" : "Create passkey"}</button>
  </main>;
}
