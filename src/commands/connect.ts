import inquirer from "inquirer";
import { requireCredentials, updateCredentials } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { GatewayClient } from "../lib/gateway-client.js";
import { spinner, printSuccess, printError, printWarning, dim } from "../lib/ui.js";

export interface ConnectOptions {
  token?: string;
  domain?: string;
}

export async function connectCommand(opts: ConnectOptions = {}) {
  const creds = requireCredentials();

  // If user provided --token manually (for existing instances without CLI provisioning)
  if (opts.token) {
    const domain = opts.domain ?? creds.instance_domain;
    if (!domain) {
      printError("Instance domain required. Use --domain <your-instance.starkbot.cloud> or run `starkbot status` first.");
      return;
    }

    updateCredentials({
      gateway_token: opts.token,
      instance_domain: domain,
    });

    const spin = spinner("Testing connection...");
    spin.start();

    try {
      const gw = new GatewayClient(`https://${domain}`, opts.token);
      const ok = await gw.ping();
      spin.stop();

      if (ok) {
        printSuccess(`Connected to ${domain}`);
        console.log(dim(`  Run \`starkbot chat\` to start chatting.`));
      } else {
        printWarning(`Gateway token saved for ${domain}, but instance is not responding yet.`);
        console.log(dim("  The instance may still be starting. Try again in a moment."));
      }
    } catch (err: any) {
      spin.fail("Connection failed");
      printError(err.message);
    }
    return;
  }

  // Auto-fetch token from flash (only works for instances provisioned with CLI support)
  const client = new FlashClient(creds.jwt);
  const spin = spinner("Fetching gateway credentials...");
  spin.start();

  try {
    const { token, domain } = await client.getGatewayToken();

    updateCredentials({
      gateway_token: token,
      instance_domain: domain,
    });

    spin.text = "Testing connection...";

    const gw = new GatewayClient(`https://${domain}`, token);
    const ok = await gw.ping();

    spin.stop();

    if (ok) {
      printSuccess(`Connected to ${domain}`);
      console.log(dim(`  Run \`starkbot chat\` to start chatting.`));
    } else {
      printWarning(`Gateway token saved for ${domain}, but instance is not responding yet.`);
      console.log(dim("  The instance may still be starting. Try again in a moment."));
    }
  } catch (err: any) {
    spin.fail("Connection failed");
    if (err.message?.includes("No CLI gateway token found")) {
      printWarning("This instance was provisioned before CLI support — no gateway token on file.");
      console.log(dim("  You can grab your token and domain from the instance dashboard.\n"));

      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "token",
          message: "Gateway token:",
          validate: (v: string) => v.trim().length > 0 || "Token is required",
        },
        {
          type: "input",
          name: "domain",
          message: "Instance domain (e.g. my-bot.starkbot.cloud):",
          default: creds.instance_domain || undefined,
          validate: (v: string) => v.trim().length > 0 || "Domain is required",
        },
      ]);

      // Re-run connect with the provided values
      return connectCommand({ token: answers.token.trim(), domain: answers.domain.trim() });
    } else {
      printError(err.message);
    }
  }
}
