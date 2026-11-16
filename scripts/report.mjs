/**
 * Prints a check's outcome and sets a failing exit code when it found problems.
 *
 * @param {string} check
 * @param {readonly string[]} problems
 * @param {string} success
 */
export function report(check, problems, success) {
  if (problems.length === 0) {
    console.log(`${check} OK — ${success}`);
    return;
  }
  console.error(`${check} failed — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}
