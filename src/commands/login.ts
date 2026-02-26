import inquirer from "inquirer";
import { runOAuthFlow } from "../lib/auth.js";
import { saveCredentials, loadCredentials, isJwtExpired } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { GatewayClient } from "../lib/gateway-client.js";
import { printSuccess, printWarning, printError, spinner } from "../lib/ui.js";

export async function loginCommand() {
  // Check if already logged in with valid token
  const existing = loadCredentials();
  if (existing && !isJwtExpired(existing)) {
    printWarning(`Already logged in as @${existing.username}. Use \`starkbot logout\` first to switch accounts.`);
    return;
  }

  const { loginMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "loginMethod",
      message: "How would you like to connect?",
      choices: [
        { name: "Login with X", value: "x" },
        { name: "Custom external channel", value: "external" },
      ],
    },
  ]);

  if (loginMethod === "external") {
    await externalLogin();
  } else {
    await xLogin();
  }
}

async function xLogin() {
  // Run OAuth flow
  const result = await runOAuthFlow();

  // Fetch full user info to get tenant_id
  const spin = spinner("Fetching account info...");
  spin.start();

  try {
    const client = new FlashClient(result.jwt);
    const me = await client.getMe();

    saveCredentials({
      jwt: result.jwt,
      username: me.user.username,
      tenant_id: me.tenant.id,
      instance_domain: me.tenant.domain ?? undefined,
      jwt_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      mode: "x",
    });

    spin.stop();
    printSuccess(`Logged in as @${me.user.username}`);

    if (me.tenant.status === "pending") {
      console.log("\n  Your bot is not yet provisioned. Run `starkbot subscribe` then `starkbot provision`.");
    } else if (me.tenant.status === "active" && me.tenant.domain) {
      console.log(`\n  Your bot is running at ${me.tenant.domain}`);
    }
  } catch {
    // If /me fails, store what we have from the callback
    spin.stop();
    saveCredentials({
      jwt: result.jwt,
      username: result.username,
      tenant_id: result.tenant_id ?? "",
      mode: "x",
    });
    printSuccess(`Logged in as @${result.username}`);
  }
}

async function externalLogin() {
  const { instanceUrl, apiToken } = await inquirer.prompt([
    {
      type: "input",
      name: "instanceUrl",
      message: "Instance URL (e.g. mybot.example.com):",
      filter: (val: string) => {
        const v = val.trim();
        if (v && !/^https?:\/\//i.test(v)) return `http://${v}`;
        return v;
      },
      validate: (val: string) => {
        if (!val.trim()) return "Instance URL is required";
        try {
          new URL(val.trim());
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    },
    {
      type: "password",
      name: "apiToken",
      message: "API token:",
      mask: "*",
      validate: (val: string) => val.trim() ? true : "API token is required",
    },
  ]);

  const url = new URL(instanceUrl.trim());
  const domain = url.host;
  const baseUrl = url.origin;
  const token = apiToken.trim();

  const spin = spinner("Testing connection...");
  spin.start();

  try {
    const gw = new GatewayClient(baseUrl, token);
    const ok = await gw.ping();
    spin.stop();

    if (!ok) {
      printError("Instance is not responding. Check the URL and try again.");
      return;
    }

    saveCredentials({
      jwt: "",
      username: "external",
      tenant_id: "",
      gateway_token: token,
      instance_domain: domain,
      instance_url: baseUrl,
      mode: "external",
    });

    printSuccess(`Connected to ${domain}`);
  } catch (err: any) {
    spin.stop();
    printError(`Connection failed: ${err.message}`);
  }
}
