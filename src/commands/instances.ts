import { requireCredentials, saveCredentials, loadCredentials } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import {
  spinner, printSuccess, printError, printWarning, printKeyValue,
  bold, dim, success, warn, error, info,
} from "../lib/ui.js";
import inquirer from "inquirer";

export async function instancesListCommand() {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  const spin = spinner("Fetching instances...");
  spin.start();

  try {
    const instances = await client.listInstances();
    spin.stop();

    if (instances.length === 0) {
      printWarning("No instances found. Run `starkbot instances new` to create one.");
      return;
    }

    console.log(bold(`\n  Your Instances (${instances.length})\n`));

    for (const inst of instances) {
      const active = inst.id === creds.tenant_id;
      const marker = active ? success(" * ") : "   ";
      const statusColor =
        inst.status === "active" ? success :
        inst.status === "pending" ? dim : warn;

      const name = inst.display_name ?? inst.id;
      console.log(`${marker}${bold(name)}${active ? dim(" (active)") : ""}`);
      printKeyValue("    ID", inst.id);
      printKeyValue("    Status", statusColor(inst.status));
      printKeyValue("    Domain", inst.domain);
      printKeyValue("    Wallet", inst.wallet_address);
      if (inst.subscription) {
        printKeyValue("    Subscription", inst.subscription.status);
      }
      console.log();
    }
  } catch (err: any) {
    spin.fail("Failed to fetch instances");
    printError(err.message);
  }
}

export async function instancesNewCommand(opts: { name?: string }) {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  const spin = spinner("Creating new instance...");
  spin.start();

  try {
    const result = await client.createInstance(opts.name);
    spin.stop();

    printSuccess(`Created instance ${bold(result.tenant.id)}`);
    if (result.tenant.domain) {
      printKeyValue("Domain", result.tenant.domain);
    }
    printKeyValue("Status", result.tenant.status);

    // The response includes a new JWT scoped to the new instance
    if (result.jwt) {
      saveCredentials({
        ...creds,
        jwt: result.jwt,
        tenant_id: result.tenant.id,
        // Clear gateway credentials since this is a new instance
        gateway_token: undefined,
        instance_domain: undefined,
      });
      console.log(dim("\n  Switched to new instance. Run `starkbot provision` to deploy it."));
    }
  } catch (err: any) {
    spin.fail("Failed to create instance");
    printError(err.message);
  }
}

export async function instancesSelectCommand(tenantId?: string) {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  // If no tenant ID provided, show interactive picker
  if (!tenantId) {
    const spin = spinner("Fetching instances...");
    spin.start();

    try {
      const instances = await client.listInstances();
      spin.stop();

      if (instances.length <= 1) {
        printWarning("You only have one instance. Nothing to switch to.");
        return;
      }

      const choices = instances.map((inst) => ({
        name: `${inst.display_name ?? inst.id} ${dim(`(${inst.status}${inst.domain ? ` - ${inst.domain}` : ""})`)}${inst.id === creds.tenant_id ? success(" *active*") : ""}`,
        value: inst.id,
      }));

      const answer = await inquirer.prompt([
        {
          type: "list",
          name: "tenantId",
          message: "Select instance:",
          choices,
        },
      ]);
      tenantId = answer.tenantId;
    } catch (err: any) {
      spin.fail("Failed to fetch instances");
      printError(err.message);
      return;
    }
  }

  if (tenantId === creds.tenant_id) {
    printWarning("Already on that instance.");
    return;
  }

  const spin = spinner("Switching instance...");
  spin.start();

  try {
    const result = await client.switchInstance(tenantId!);
    spin.stop();

    saveCredentials({
      ...creds,
      jwt: result.jwt,
      tenant_id: result.tenant.id,
      // Clear gateway credentials for the new active instance
      gateway_token: undefined,
      instance_domain: result.tenant.domain ?? undefined,
    });

    const name = result.tenant.id;
    printSuccess(`Switched to ${bold(name)}`);
    printKeyValue("Status", result.tenant.status);
    printKeyValue("Domain", result.tenant.domain);

    if (result.tenant.status === "active" && result.tenant.domain) {
      console.log(dim("\n  Run `starkbot connect` to set up the gateway connection."));
    } else if (result.tenant.status === "pending") {
      console.log(dim("\n  Run `starkbot provision` to deploy this instance."));
    }
  } catch (err: any) {
    spin.fail("Failed to switch instance");
    printError(err.message);
  }
}

export async function instancesDeleteCommand(tenantId?: string) {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  // If deleting a different instance, switch to it first
  if (tenantId && tenantId !== creds.tenant_id) {
    const spin = spinner("Switching to target instance...");
    spin.start();

    try {
      const result = await client.switchInstance(tenantId);
      spin.stop();

      // Update credentials to the target instance
      saveCredentials({
        ...creds,
        jwt: result.jwt,
        tenant_id: result.tenant.id,
        gateway_token: undefined,
        instance_domain: undefined,
      });

      // Re-read credentials with new JWT
      const newCreds = requireCredentials();
      const newClient = new FlashClient(newCreds.jwt);
      await doDelete(newClient, tenantId, newCreds);
    } catch (err: any) {
      spin.fail("Failed to switch to target instance");
      printError(err.message);
    }
    return;
  }

  await doDelete(client, creds.tenant_id, creds);
}

async function doDelete(client: FlashClient, tenantId: string, creds: ReturnType<typeof requireCredentials>) {
  // Confirm deletion
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Delete instance ${bold(tenantId)}? This cannot be undone.`,
      default: false,
    },
  ]);

  if (!answer.confirm) {
    console.log(dim("Cancelled."));
    return;
  }

  const spin = spinner("Deleting instance...");
  spin.start();

  try {
    await client.deleteInstance();
    spin.stop();
    printSuccess(`Deleted instance ${tenantId}`);

    // Switch back to another instance
    const me = await new FlashClient(creds.jwt).getMe();
    if (me.tenants && me.tenants.length > 0) {
      const first = me.tenants[0];
      const switchResult = await new FlashClient(creds.jwt).switchInstance(first.id);
      saveCredentials({
        ...creds,
        jwt: switchResult.jwt,
        tenant_id: switchResult.tenant.id,
        gateway_token: undefined,
        instance_domain: switchResult.tenant.domain ?? undefined,
      });
      console.log(dim(`  Switched to instance ${first.id}`));
    }
  } catch (err: any) {
    spin.fail("Failed to delete instance");
    printError(err.message);
  }
}
