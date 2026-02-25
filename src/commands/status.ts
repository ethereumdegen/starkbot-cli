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

  // Credits
  console.log(bold("\n  Credits"));
  const creditBalance = me.credits?.balance ?? 0;
  const formattedCredits = (creditBalance / 1_000_000).toFixed(2);
  const creditColor = creditBalance > 0 ? success : warn;
  printKeyValue("Balance", creditColor(`$${formattedCredits}`));
  if (me.credits?.last_active_at) {
    const lastActive = new Date(me.credits.last_active_at);
    const daysSinceActive = Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    const lastActiveStr = lastActive.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    printKeyValue("Last active", `${lastActiveStr} (${daysSinceActive}d ago)`);
    if (daysSinceActive >= 30) {
      console.log(error("    ⚠ Inactive for 30+ days — instance will be suspended."));
    } else if (daysSinceActive >= 25) {
      console.log(warn("    ⚠ Approaching 30-day inactivity limit — instance may be suspended soon."));
    }
  }
  if (creditBalance <= 0) {
    console.log(warn("    ⚠ No credits remaining. Run `starkbot subscribe` to add credits."));
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
