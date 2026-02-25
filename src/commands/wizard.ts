import inquirer from "inquirer";
import { loadCredentials, isJwtExpired, requireCredentials, updateCredentials } from "../lib/credentials.js";
import { FlashClient, type InstanceSummary } from "../lib/flash-client.js";
import { banner, printSuccess, printWarning, dim, bold, spinner } from "../lib/ui.js";
import { loginCommand } from "./login.js";
import { subscribeCommand } from "./subscribe.js";
import { provisionCommand } from "./provision.js";
import { connectCommand } from "./connect.js";
import { chatReplCommand } from "./chat.js";

export async function wizardCommand() {
  banner();

  // Step 1: Login
  const creds = loadCredentials();
  if (!creds || isJwtExpired(creds)) {
    console.log(bold("  Step 1: Login with X\n"));
    await loginCommand();
    console.log();
  } else {
    printSuccess(`Logged in as @${creds.username}`);
  }

  // Step 2: Check account info
  const currentCreds = requireCredentials();
  const client = new FlashClient(currentCreds.jwt);

  const spin = spinner("Checking account...");
  spin.start();

  let me;
  try {
    me = await client.getMe();
    spin.stop();
  } catch (err: any) {
    spin.fail("Failed to check account status");
    console.log(dim(`  Error: ${err.message}`));
    return;
  }

  // Step 3: Instance selection (if user has existing instances)
  const hasInstances = me.tenants && me.tenants.length > 0;
  if (!me.is_new_user && hasInstances) {
    const instances = me.tenants!;

    // Build choices: existing instances + "Create new"
    const choices = instances.map((inst) => {
      const statusTag = inst.status === "active" ? "active" : inst.status;
      const domain = inst.domain ? ` — ${inst.domain}` : "";
      const name = inst.display_name || inst.id.slice(0, 8);
      const isCurrent = inst.id === me.tenant.id;
      const label = `${name}${domain} (${statusTag})${isCurrent ? " ← current" : ""}`;
      return { name: label, value: inst.id };
    });
    choices.push({ name: "Create new instance", value: "__new__" });

    console.log(bold("\n  Select an instance\n"));
    const { instanceChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "instanceChoice",
        message: "Which instance do you want to work with?",
        choices,
        default: me.tenant.id,
      },
    ]);

    if (instanceChoice === "__new__") {
      // Proceed to provision flow — will create a new instance
      const { displayName } = await inquirer.prompt([
        {
          type: "input",
          name: "displayName",
          message: "Display name for the new instance (optional):",
        },
      ]);

      const createSpin = spinner("Creating instance...");
      createSpin.start();
      try {
        me = await client.createInstance(displayName || undefined);
        updateCredentials({ tenant_id: me.tenant.id, gateway_token: undefined, instance_domain: undefined });
        createSpin.succeed("Instance created");
      } catch (err: any) {
        createSpin.fail("Failed to create instance");
        console.log(dim(`  Error: ${err.message}`));
        return;
      }
    } else if (instanceChoice !== me.tenant.id) {
      // Switch to selected instance
      const switchSpin = spinner("Switching instance...");
      switchSpin.start();
      try {
        me = await client.switchInstance(instanceChoice);
        updateCredentials({ tenant_id: me.tenant.id, gateway_token: undefined, instance_domain: undefined });
        switchSpin.succeed(`Switched to instance ${me.tenant.domain || instanceChoice}`);
      } catch (err: any) {
        switchSpin.fail("Failed to switch instance");
        console.log(dim(`  Error: ${err.message}`));
        return;
      }
    } else {
      printSuccess(`Using current instance${me.tenant.domain ? ` (${me.tenant.domain})` : ""}`);
    }
    console.log();
  }

  // Step 4: Subscription
  if (!me.subscription || me.subscription.status !== "active") {
    console.log(bold("\n  Subscribe\n"));
    await subscribeCommand();

    // Re-check after subscribe
    try {
      me = await client.getMe();
    } catch {
      return;
    }

    if (!me.subscription || me.subscription.status !== "active") {
      printWarning("Subscription required to continue. Run `starkbot subscribe` when ready.");
      return;
    }
    console.log();
  } else {
    printSuccess(`Subscription active (${me.subscription.days_remaining} days remaining)`);
  }

  // Step 5: Provision
  if (me.tenant.status !== "active" || !me.tenant.domain) {
    console.log(bold("\n  Provision your bot\n"));
    await provisionCommand();
    console.log();
  } else {
    printSuccess(`Instance running at ${me.tenant.domain}`);
  }

  // Step 6: Connect gateway
  const updatedCreds = loadCredentials();
  if (!updatedCreds?.gateway_token || !updatedCreds?.instance_domain) {
    console.log(bold("\n  Connect to gateway\n"));
    await connectCommand();
    console.log();
  } else {
    printSuccess("Gateway connected");
  }

  // Step 7: Chat
  const finalCreds = loadCredentials();
  if (finalCreds?.gateway_token && finalCreds?.instance_domain) {
    const { startChat } = await inquirer.prompt([
      {
        type: "confirm",
        name: "startChat",
        message: "Start chatting with your bot?",
        default: true,
      },
    ]);

    if (startChat) {
      console.log();
      await chatReplCommand();
    }
  }
}
