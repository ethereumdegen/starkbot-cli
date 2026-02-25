import { requireCredentials } from "../lib/credentials.js";
import { GatewayClient } from "../lib/gateway-client.js";
import { spinner, printError, prefix, dim } from "../lib/ui.js";

export async function historyCommand(sessionId: string) {
  const creds = requireCredentials();
  if (!creds.gateway_token || !creds.instance_domain) {
    throw new Error("Gateway not configured. Run `starkbot connect` first.");
  }

  const sid = parseInt(sessionId, 10);
  if (isNaN(sid)) {
    printError(`Invalid session ID: ${sessionId}`);
    process.exit(1);
  }

  const gw = new GatewayClient(
    `https://${creds.instance_domain}`,
    creds.gateway_token
  );

  const spin = spinner("Fetching message history...");
  spin.start();

  try {
    const resp = await gw.getHistory(sid);
    spin.stop();

    if (resp.messages.length === 0) {
      console.log(dim("  No messages in this session."));
      return;
    }

    console.log();
    for (const m of resp.messages) {
      const p =
        m.role === "user"
          ? prefix.you
          : m.role === "assistant"
            ? prefix.agent
            : dim(`${m.role}>`);
      console.log(`${p} ${m.content}`);
    }
    console.log();
  } catch (err: any) {
    spin.fail("Failed to fetch history");
    printError(err.message);
  }
}
