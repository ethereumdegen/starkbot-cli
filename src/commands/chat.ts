import { createInterface } from "node:readline/promises";
import { requireCredentials, updateCredentials, loadCredentials, getInstanceUrl } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { GatewayClient, type SseEvent } from "../lib/gateway-client.js";
import { StatusTracker } from "../lib/status.js";
import { prefix, printError, dim, info, printSuccess, printWarning, warn } from "../lib/ui.js";

function requireGateway() {
  const creds = requireCredentials();
  if (!creds.gateway_token || !creds.instance_domain) {
    throw new Error(
      "Gateway not configured. Run `starkbot connect` first."
    );
  }
  return new GatewayClient(
    getInstanceUrl(creds),
    creds.gateway_token
  );
}

function isAuthError(err: any): boolean {
  return err?.message?.includes("HTTP 401") || err?.message?.includes("Invalid gateway token");
}

/** Try to auto-refresh the gateway token using the stored JWT */
async function tryRefreshToken(): Promise<GatewayClient | null> {
  const creds = loadCredentials();
  if (!creds?.jwt) return null;

  try {
    const client = new FlashClient(creds.jwt);
    const { token, domain } = await client.getGatewayToken();
    updateCredentials({ gateway_token: token, instance_domain: domain });
    const url = creds.instance_url ?? `https://${domain}`;
    const gw = new GatewayClient(url, token);
    const ok = await gw.ping();
    if (ok) {
      printSuccess("Gateway token refreshed automatically.");
      return gw;
    }
  } catch {
    // auto-refresh failed, caller will prompt user
  }
  return null;
}

/** One-shot message mode */
export async function chatOneShotCommand(message: string) {
  let gw = requireGateway();
  const status = new StatusTracker();

  process.stdout.write(`${prefix.agent} `);
  try {
    await gw.chatStream(message, (event) => status.handleEvent(event));
    console.log();
  } catch (err: any) {
    status.finish();
    console.log();
    if (isAuthError(err)) {
      printWarning("Gateway token is invalid or expired. Attempting to refresh...");
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        gw = refreshed;
        process.stdout.write(`${prefix.agent} `);
        const status2 = new StatusTracker();
        try {
          await gw.chatStream(message, (event) => status2.handleEvent(event));
          console.log();
          return;
        } catch (retryErr: any) {
          status2.finish();
          console.log();
          printError(retryErr.message);
        }
      } else {
        printError("Could not refresh token. Run `starkbot connect` to set a new gateway token.");
      }
    } else {
      printError(err.message);
    }
    process.exit(1);
  }
}

/** Interactive REPL mode */
export async function chatReplCommand() {
  let gw = requireGateway();

  console.log(
    dim(
      "Starkbot CLI — type a message, /new to reset, /sessions to list, /connect to refresh token, /quit to exit"
    )
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Use a proper async loop so the REPL stays alive across long-running requests
  let running = true;
  while (running) {
    let input: string;
    try {
      input = await rl.question(`${prefix.you} `);
    } catch {
      // stdin closed (e.g. Ctrl+D)
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    switch (trimmed) {
      case "/quit":
      case "/exit":
      case "/q":
        running = false;
        console.log(dim("Goodbye!"));
        break;

      case "/new": {
        try {
          const resp = await gw.newSession();
          console.log(
            `${prefix.system} New session created (id: ${resp.session_id})`
          );
        } catch (err: any) {
          console.log(`${prefix.error} ${err.message}`);
        }
        break;
      }

      case "/sessions": {
        try {
          const resp = await gw.listSessions();
          if (resp.sessions.length === 0) {
            console.log(`${prefix.system} No sessions found`);
          } else {
            console.log(`${prefix.system} Sessions:`);
            for (const s of resp.sessions) {
              console.log(
                `  ${info(s.session_key)} | ${s.message_count} msgs | last active: ${dim(s.last_activity_at)}`
              );
            }
          }
        } catch (err: any) {
          console.log(`${prefix.error} ${err.message}`);
        }
        break;
      }

      case "/connect": {
        console.log(`${prefix.system} Refreshing gateway token...`);
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          gw = refreshed;
        } else {
          console.log(`${prefix.system} Auto-refresh failed. Enter a new gateway token manually.`);
          try {
            const newToken = (await rl.question(`${prefix.system} Gateway token: `)).trim();
            if (newToken) {
              const creds = requireCredentials();
              const domain = creds.instance_domain!;
              updateCredentials({ gateway_token: newToken });
              const url = creds.instance_url ?? `https://${domain}`;
              gw = new GatewayClient(url, newToken);
              const ok = await gw.ping();
              if (ok) {
                printSuccess(`Reconnected to ${domain}`);
              } else {
                printWarning("Token saved but instance is not responding.");
              }
            } else {
              console.log(`${prefix.system} Cancelled.`);
            }
          } catch {
            // stdin closed during token entry
          }
        }
        break;
      }

      case "/modules":
      case "/modules list": {
        try {
          const resp = await gw.listModules();
          if (resp.modules.length === 0) {
            console.log(`${prefix.system} No modules installed.`);
          } else {
            console.log(`${prefix.system} Installed modules:`);
            for (const m of resp.modules) {
              const tui = m.has_tui ? info("[TUI]") : "";
              console.log(`  ${info(m.name)} ${dim(m.version)} ${tui} ${dim(m.description)}`);
            }
            console.log(dim("  Use /modules connect <name> to open a TUI dashboard"));
          }
        } catch (err: any) {
          console.log(`${prefix.error} ${err.message}`);
        }
        break;
      }

      case "/help":
        console.log(`${prefix.system} Commands:`);
        console.log(`  ${info("/new")}      — Start a new session`);
        console.log(`  ${info("/sessions")} — List sessions`);
        console.log(
          `  ${info("/history <id>")} — Show message history`
        );
        console.log(`  ${info("/modules")}  — List installed modules`);
        console.log(`  ${info("/modules connect <name>")} — Open module TUI`);
        console.log(`  ${info("/connect")}  — Refresh gateway token`);
        console.log(`  ${info("/quit")}     — Exit`);
        break;

      default:
        if (trimmed.startsWith("/modules connect ")) {
          const name = trimmed.slice("/modules connect ".length).trim();
          if (!name) {
            console.log(`${prefix.system} Usage: /modules connect <module_name>`);
          } else {
            // Close readline, launch TUI, then it will exit the process
            rl.close();
            const { modulesConnectCommand } = await import("./modules.js");
            await modulesConnectCommand(name);
            return;
          }
          break;
        }

        if (trimmed.startsWith("/history")) {
          const parts = trimmed.split(/\s+/);
          if (parts.length < 2) {
            console.log(
              `${prefix.system} Usage: /history <session_id>`
            );
          } else {
            const sid = parseInt(parts[1], 10);
            if (isNaN(sid)) {
              console.log(`${prefix.error} Invalid session ID: ${parts[1]}`);
            } else {
              try {
                const resp = await gw.getHistory(sid);
                for (const m of resp.messages) {
                  const p =
                    m.role === "user"
                      ? prefix.you
                      : m.role === "assistant"
                        ? prefix.agent
                        : dim(`${m.role}>`);
                  console.log(`${p} ${m.content}`);
                }
              } catch (err: any) {
                console.log(`${prefix.error} ${err.message}`);
              }
            }
          }
          break;
        }

        // Send message with streaming
        process.stdout.write(`${prefix.agent} `);
        try {
          const status = new StatusTracker();
          await gw.chatStream(trimmed, (event) => status.handleEvent(event));
          console.log();
        } catch (err: any) {
          console.log();
          if (isAuthError(err)) {
            console.log(`${prefix.error} ${err.message}`);
            console.log(warn("  Gateway token is invalid or expired. Attempting to refresh..."));
            const refreshed = await tryRefreshToken();
            if (refreshed) {
              gw = refreshed;
              console.log(dim("  Try your message again."));
            } else {
              console.log(warn("  Auto-refresh failed. Use /connect to enter a new token."));
            }
          } else {
            console.log(`${prefix.error} ${err.message}`);
          }
        }
    }
  }

  rl.close();
  process.exit(0);
}
