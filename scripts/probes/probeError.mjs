/** A failure whose message the probe tooling wrote itself; it never carries a value. */
export class ProbeError extends Error {
  /** @override */
  name = 'ProbeError';
}
