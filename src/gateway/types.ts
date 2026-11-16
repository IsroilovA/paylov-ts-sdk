/** A bank as `paylov.gateway.listBanks()` returns it. */
export interface Bank {
  /** The gateway's integer id as a string, so it compares equal to a card's `bankId`. */
  readonly bankId: string;
  /** Display name, e.g. `Hamkorbank`; may contain non-ASCII letters and backticks. */
  readonly name: string;
  /** `null` when Paylov has no official name for the bank. */
  readonly officialName: string | null;
}
