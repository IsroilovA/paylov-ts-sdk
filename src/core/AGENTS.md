Shared runtime primitives. [Architecture](../../docs/architecture.md#transport) owns the rationale
for these policies.

- Failure retries stay GET-only, and the single re-authentication replay stays limited to an
  enveloped 401 `permission_denied`. Never broaden either policy.
- Never retry a received 429 automatically, even when its body read fails; surface it with
  `retryAfterSeconds`. Any token-endpoint 429 starts the cool-down instead of a new grant.
- A caller's abort is final: never retry `sdk_aborted`, and abandon only the caller's wait on a
  shared token grant, never the grant itself. Its `isSent` is `false` only while no attempt of the
  call has reached fetch.
- Decoders throw only `DecodeFailure` or `DecodedMiss`. `decodePayload` is their only converter to a
  public error, used only where a response exists; never catch other exceptions around a decoder.
- The transport runs the endpoint's decoder before it emits an attempt's response event, exactly
  once per attempt; a decoded miss logs no code. Never emit the event before decoding.
- `isOutcomeUnknown` is the only carrier of an ambiguous outcome: set it when the error is built,
  from the requested endpoint's effect, and add no second flag or predicate. It describes the
  requested operation: a failure before any attempt that could execute it (a failed grant, a refusal
  before fetch) is known. Derive a caller's copy of a shared grant error; never mutate it.
- GET endpoints are reads. Keep them so: GET-only retries rely on a retried attempt changing
  nothing.
- `close()` never rejects after the local close; report revocation failures through logger events.
- Logger hooks run synchronously and may close the client or abort the call. Recheck both after the
  request hook, immediately before fetch, and register a shared grant before starting work that can
  run a hook, so `close()` always awaits it.
- Exceptions thrown by caller getters or proxies propagate unchanged; add no read hardening for
  them.
- Keep regression coverage for token generations, single-flight, refresh fallback, the password
  latch, cool-down, close, deadlines, and secret safety when changing those paths.
- Discard arbitrary transport errors and gateway diagnostic data. Logger events and public errors
  carry allowlisted metadata only; never attach raw causes.
