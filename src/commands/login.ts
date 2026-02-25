import { runOAuthFlow } from "../lib/auth.js";
import { saveCredentials, loadCredentials, isJwtExpired } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { printSuccess, printWarning, spinner } from "../lib/ui.js";

export async function loginCommand() {
  // Check if already logged in with valid token
  const existing = loadCredentials();
  if (existing && !isJwtExpired(existing)) {
    printWarning(`Already logged in as @${existing.username}. Use \`starkbot logout\` first to switch accounts.`);
    return;
  }

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
    });
    printSuccess(`Logged in as @${result.username}`);
  }
}
