Transport, authentication, lifecycle, envelope, errors, decoding, readers, call helpers, money, and
time primitives. [Architecture](../../docs/architecture.md#transport) owns the rationale for these
policies.

- Failure retries stay GET-only, and the single re-authentication replay stays limited to an
  enveloped 401 `permission_denied`. Never broaden either policy.
- Never retry a received 429 automatically, even when its body read fails; surface it with
  `retryAfterSeconds`. Any token-endpoint 429 starts the cool-down instead of a new grant.
- A caller's abort is final: never retry `sdk_aborted`, and abandon only the caller's wait on a
  shared token grant, never the grant itself. Its `isSent` is `false` only while no attempt of the
  call has reached fetch.
- Decoders throw only `DecodeFailure`. Convert it to a public error only where a response exists
  (`decodePayload`), and never catch other exceptions around a decoder.
- `close()` never rejects after the local close; report revocation failures through logger events.
- Logger hooks run synchronously and may close the client or abort the call. Recheck both after the
  request hook, immediately before fetch, and register a shared grant before starting work that can
  run a hook, so `close()` always awaits it.
- Exceptions thrown by caller getters or proxies propagate unchanged; do not reintroduce read
  hardening for them.
- Keep regression coverage for token generations, single-flight, refresh fallback, the password
  latch, cool-down, close, deadlines, and secret safety when changing those paths.
- Discard arbitrary transport errors and gateway diagnostic data. Logger events and public errors
  carry allowlisted metadata only; never attach raw causes.
