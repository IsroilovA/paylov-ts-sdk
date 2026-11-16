---
name: write-tests
description:
  Use when choosing test coverage or adding, changing, reviewing, or removing paylov-ts-sdk tests.
---

# Write tests

## Choose coverage

- Read the owning reference, implementation, and nearby assertions. Identify a plausible SDK
  regression and what existing coverage misses before adding a test.
- Give behavior one primary boundary: pure rules directly, wire contracts through the injected fake
  fetch and fixtures, public typing in `tests/types/`, package integration through the packed
  consumer check.
- Preserve distinct money, security, concurrency, cancellation, and recovery cases. Add another
  layer only for an independent integration risk.
- Skip trivial getters and forwarders, symbol existence, dependency behavior, and guarantees types
  already prove. Malformed JavaScript at public boundaries still needs runtime coverage.

## Assert behavior

- Derive expectations from the reference, fixtures, or requirements, never from the implementation
  under test. Mock external boundaries, not the tested behavior; add no production exports solely
  for tests.
- Assert the smallest stable observable outcome. Request bytes, headers, and call counts matter only
  when they establish a wire or replay contract.
- Use deterministic time and isolated mocks. Await complete outcomes.

## Review and verify

- A plausible bug must fail the assertions; harmless refactors should not. Demonstrate failure
  against pre-fix behavior when feasible without disturbing current work, and report when not.
- Remove duplicate tests only when retained coverage catches the same failure.
- Fix setup, leaks, or impossible waits; never mask failures with longer timeouts, retries, or
  skips.
