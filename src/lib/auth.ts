import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import open from "open";
import { FlashClient } from "./flash-client.js";
import { spinner, printError, dim } from "./ui.js";

export interface AuthResult {
  jwt: string;
  username: string;
  tenant_id?: string;
}

/**
 * Run the CLI OAuth flow:
 * 1. Start a local HTTP server on a random port
 * 2. Call flash API to get the X auth URL with cli_redirect
 * 3. Open browser to X authorization
 * 4. Wait for callback with JWT
 * 5. Verify CSRF nonce on callback
 */
export async function runOAuthFlow(): Promise<AuthResult> {
  return new Promise<AuthResult>((resolve, reject) => {
    let server: Server;
    let timeout: ReturnType<typeof setTimeout>;
    const csrfNonce = randomBytes(16).toString("hex");

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname === "/callback") {
        // Verify CSRF nonce to prevent cross-site callback injection
        const returnedNonce = url.searchParams.get("nonce");
        if (returnedNonce !== csrfNonce) {
          res.writeHead(403, { "Content-Type": "text/html" });
          res.end("<h1>Forbidden</h1><p>Invalid CSRF nonce.</p>");
          return;
        }

        const jwt = url.searchParams.get("jwt");
        const username = url.searchParams.get("username");
        const tenantId = url.searchParams.get("tenant_id");

        if (jwt && username) {
          // Send success page to browser
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Starkbot CLI</title></head>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f0f0f; color: #e0e0e0;">
              <div style="text-align: center;">
                <h1 style="color: #7C3AED;">&#9889; Logged in!</h1>
                <p>You can close this tab and return to the terminal.</p>
              </div>
            </body>
            </html>
          `);

          clearTimeout(timeout);
          server.close();
          resolve({
            jwt,
            username,
            tenant_id: tenantId ?? undefined,
          });
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Login failed</h1><p>Missing JWT or username in callback.</p>");
          clearTimeout(timeout);
          server.close();
          reject(new Error("OAuth callback missing jwt or username"));
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Listen on random port, bound to localhost only
    server.listen(0, "127.0.0.1", async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const callbackUrl = `http://localhost:${port}/callback?nonce=${csrfNonce}`;

      try {
        // Get auth URL from flash with CLI redirect
        const spin = spinner("Preparing login...");
        spin.start();
        const client = new FlashClient("");
        const { url } = await client.getAuthUrl(callbackUrl);
        spin.stop();

        // Prompt user before opening browser
        console.log(dim("  Your browser will open for X authorization.\n"));
        await new Promise<void>((res) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question("  Press Enter when you're ready to log in to X...", () => {
            rl.close();
            res();
          });
        });

        const loginSpin = spinner("Opening browser for X login...");
        loginSpin.start();

        // Open browser
        await open(url);
        loginSpin.text = "Waiting for login in browser...";

        // Timeout after 5 minutes
        timeout = setTimeout(() => {
          loginSpin.fail("Login timed out (5 minutes)");
          server.close();
          reject(new Error("Login timed out"));
        }, 5 * 60 * 1000);
      } catch (err) {
        printError("Failed to start login");
        server.close();
        reject(err);
      }
    });

    server.on("error", (err) => {
      reject(new Error(`Local server error: ${err.message}`));
    });
  });
}
