# Script invariants

The [root engineering principles](../AGENTS.md) apply here.

Isolated browser journeys must exercise the real passkey registration and authentication path. Do
not add an authentication bypass, seed a session, weaken passkey verification, or enable a second
sign-in mechanism for browser testing.

- Seed application state only after real registration and through authenticated application
  boundaries.
- Keep isolated data disposable and prove cleanup cannot affect a developer's ordinary data.
- Virtual authenticator credentials are ephemeral secrets. Never export, persist, or commit them.
