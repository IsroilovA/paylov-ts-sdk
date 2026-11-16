import { withProbe } from './probe.mjs';

await withProbe('sandboxRead', async (probe) => {
  const reads = /** @type {const} */ ([
    ['/merchant/status/', 'none'],
    ['/merchant/bankList/', 'bearer'],
  ]);
  for (const [path, auth] of reads) {
    const result = await probe.rest('GET', path, { auth });
    process.stdout.write(`sandbox read HTTP ${result.status}\n`);
    if (result.status !== 200) throw new Error('sandbox read failed');
  }
});
