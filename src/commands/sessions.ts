import { requireCredentials } from "../lib/credentials.js";
import { GatewayClient } from "../lib/gateway-client.js";
import { spinner, printError, dim, info, bold } from "../lib/ui.js";

export async function sessionsCommand() {
  const creds = requireCredentials();
  if (!creds.gateway_token || !creds.instance_domain) {
    throw new Error("Gateway not configured. Run `starkbot connect` first.");
  }

  const gw = new GatewayClient(
    `https://${creds.instance_domain}`,
    creds.gateway_token
  );

  const spin = spinner("Fetching sessions...");
  spin.start();

  try {
    const resp = await gw.listSessions();
    spin.stop();

    if (resp.sessions.length === 0) {
      console.log(dim("  No sessions found."));
      return;
    }

    console.log(bold(`\n  Sessions (${resp.sessions.length}):\n`));
    for (const s of resp.sessions) {
      console.log(
        `  ${info(String(s.id).padStart(4))}  ${s.session_key}  ${dim(`${s.message_count} msgs`)}  ${dim(s.last_activity_at)}`
      );
    }
    console.log();
  } catch (err: any) {
    spin.fail("Failed to fetch sessions");
    printError(err.message);
  }
}
