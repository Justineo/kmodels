import { createServer, request } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This process lives inside the networkless container. The socket exposes only the trusted
// budgeted Responses endpoint and public acquisition, never the host filesystem or shell.
export function startRelay(socket: string, port = 8765) {
  return createServer((incoming, outgoing) => {
    const forwarded = request(
      {
        socketPath: socket,
        path: incoming.url,
        method: incoming.method,
        headers: { "Content-Type": "application/json" },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, {
          "Content-Type": response.headers["content-type"] ?? "application/json",
        });
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end("Gateway unavailable");
    });
    incoming.pipe(forwarded);
  }).listen(port, "127.0.0.1");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  startRelay("/gateway/api.sock");
