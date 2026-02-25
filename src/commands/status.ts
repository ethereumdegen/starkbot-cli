import { requireCredentials } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { spinner, printKeyValue, bold, dim, success, warn, error } from "../lib/ui.js";

export async function statusCommand() {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  const spin = spinner("Fetching account status...");
  spin.start();

  const me = await client.getMe();
  spin.stop();

  // Account
  console.log(bold("\n  Account"));
  printKeyValue("Username", `@${me.user.username}`);
  printKeyValue("Display name", me.user.display_name);
  printKeyValue("Wallet", me.user.wallet_address);

  // Subscription
  console.log(bold("\n  Subscription"));
  if (me.subscription) {
    const statusColor = me.subscription.status === "active" ? success : warn;
    printKeyValue("Status", statusColor(me.subscription.status));
    printKeyValue("Expires", me.subscription.expires_at);
    printKeyValue("Days remaining", String(me.subscription.days_remaining));
    if (me.subscription.is_expiring_soon) {
      console.log(warn("    ⚠ Subscription expiring soon!"));
    }
  } else {
    printKeyValue("Status", dim("none"));
    console.log(dim("    Run `starkbot subscribe` to get started."));
  }

  // Active Instance
  console.log(bold("\n  Active Instance"));
  printKeyValue("ID", me.tenant.id);
  const tenantStatus = me.tenant.status;
  const statusColor =
    tenantStatus === "active"
      ? success
      : tenantStatus === "pending"
        ? dim
        : warn;
  printKeyValue("Status", statusColor(tenantStatus));
  printKeyValue("Domain", me.tenant.domain);
  printKeyValue("Auto-update", me.tenant.auto_update_enabled ? "enabled" : "disabled");

  if (me.tenant.updating) {
    console.log(warn("    ⚠ Instance is updating..."));
  }

  // Other instances
  if (me.tenants && me.tenants.length > 1) {
    console.log(bold(`\n  All Instances (${me.tenants.length})`));
    for (const t of me.tenants) {
      const active = t.id === me.tenant.id;
      const tColor = t.status === "active" ? success : t.status === "pending" ? dim : warn;
      const label = t.display_name ?? t.id;
      console.log(`    ${active ? success("*") : " "} ${label} ${dim("—")} ${tColor(t.status)}${t.domain ? dim(` (${t.domain})`) : ""}`);
    }
    console.log(dim("\n    Use `starkbot instances select` to change active instance."));
  }

  // Premium
  if (me.premium && me.premium.status !== "none") {
    console.log(bold("\n  Premium"));
    printKeyValue("Status", me.premium.status);
    printKeyValue("Domain type", me.premium.domain_type);
    if (me.premium.custom_subdomain) {
      printKeyValue("Subdomain", me.premium.custom_subdomain);
    }
    if (me.premium.custom_domain) {
      printKeyValue("Custom domain", me.premium.custom_domain);
    }
  }

  console.log();
}
