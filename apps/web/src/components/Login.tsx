import { authClient } from "../auth-client.ts";

export function Login() {
  return <main className="center-card">
    <div className="brand-mark">cu</div>
    <h1>context-use</h1>
    <p>Your private knowledge base.</p>
    <button className="primary" onClick={() => authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/app`,
    })}>Sign in with Google</button>
  </main>;
}
