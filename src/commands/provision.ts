import { requireCredentials, updateCredentials } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { spinner, printSuccess, printError, dim } from "../lib/ui.js";

export async function provisionCommand() {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  // Check current status
  const spin = spinner("Checking instance status...");
  spin.start();

  try {
    // Let the backend handle credit validation — it enforces a $1.50 minimum
    // and returns a clear error if the tenant can't afford to provision.
    spin.text = "Provisioning your Starkbot instance...";

    const result = await client.provision();

    if (result.success) {
      // Poll deployment status until ready
      spin.text = `Deployed to ${result.domain} — waiting for instance to start...`;

      let attempts = 0;
      const maxAttempts = 60; // ~2 minutes with 2s intervals

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;

        try {
          const status = await client.getDeploymentStatus();
          if (status.ready) {
            break;
          }
          if (status.needs_reprovision) {
            spin.fail(`Deployment failed: ${status.status}`);
            return;
          }
          const statusLower = status.status.toLowerCase();
          if (statusLower === "failed" || statusLower === "crashed") {
            spin.fail(`Deployment failed: ${status.status}`);
            return;
          }
          spin.text = `Waiting for instance... (${status.status})`;
        } catch {
          // Status endpoint may not be available yet
        }
      }

      spin.stop();

      updateCredentials({ instance_domain: result.domain });
      printSuccess(`Instance provisioned at ${result.domain}`);
      console.log(dim(`  Run \`starkbot connect\` to set up the gateway connection.`));
    } else {
      spin.fail("Provisioning failed");
    }
  } catch (err: any) {
    spin.fail("Provisioning failed");
    printError(err.message);
  }
}
