/**
 * A `FetchLike` over `node:http` and `node:https` for tests that reach a real local server: it
 * sends the SDK's `https://` requests to `target` instead, trusting `ca` for TLS. The platform
 * fetch stays reserved to the transport, and a self-signed test certificate needs its own trust.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { FetchLike } from '../../src/core/types.js';

function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

export function nodeFetch(target: string, ca?: string): FetchLike {
  const origin = new URL(target);
  return (input, init) => {
    const url = new URL(input);
    const send = origin.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<Response>((resolve, reject) => {
      const outgoing = send(
        {
          protocol: origin.protocol,
          hostname: origin.hostname,
          port: origin.port,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? 'GET',
          headers: headersOf(init),
          ...(ca === undefined ? {} : { ca, servername: 'localhost' }),
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (typeof value === 'string') headers.set(name, value);
            }
            resolve(
              new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500, headers }),
            );
          });
        },
      );
      outgoing.on('error', reject);
      init.signal?.addEventListener('abort', () => outgoing.destroy(), { once: true });
      outgoing.end(typeof init.body === 'string' ? init.body : undefined);
    });
  };
}
