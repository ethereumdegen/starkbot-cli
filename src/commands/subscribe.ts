import inquirer from "inquirer";
import { requireCredentials } from "../lib/credentials.js";
import { FlashClient } from "../lib/flash-client.js";
import { spinner, printSuccess, printError, printWarning, dim } from "../lib/ui.js";

export async function subscribeCommand() {
  const creds = requireCredentials();
  const client = new FlashClient(creds.jwt);

  // Check current subscription
  const spin = spinner("Checking subscription...");
  spin.start();
  const me = await client.getMe();
  spin.stop();

  if (me.subscription && me.subscription.status === "active") {
    printSuccess(`You already have an active subscription (${me.subscription.days_remaining} days remaining).`);
    return;
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "How would you like to subscribe?",
      choices: [
        { name: "Claim free trial (7 days)", value: "trial" },
        { name: "Redeem a voucher code", value: "voucher" },
        { name: "Pay with crypto", value: "pay" },
      ],
    },
  ]);

  if (action === "trial") {
    const spin2 = spinner("Claiming free trial...");
    spin2.start();
    try {
      const result = await client.claimTrial();
      spin2.stop();
      if (result.success) {
        printSuccess("Free trial activated! You can now run `starkbot provision`.");
      } else {
        printWarning(result.message ?? "Could not claim trial — you may have already used it.");
      }
    } catch (err: any) {
      spin2.stop();
      printError(err.message);
    }
  } else if (action === "voucher") {
    const { code } = await inquirer.prompt([
      {
        type: "input",
        name: "code",
        message: "Enter voucher code:",
        validate: (v: string) => v.trim().length > 0 || "Code cannot be empty",
      },
    ]);

    const spin2 = spinner("Redeeming voucher...");
    spin2.start();
    try {
      const result = await client.redeemVoucher(code.trim());
      spin2.stop();
      if (result.success) {
        printSuccess("Voucher redeemed! You can now run `starkbot provision`.");
      } else {
        printWarning(result.message ?? "Invalid or already redeemed voucher.");
      }
    } catch (err: any) {
      spin2.stop();
      printError(err.message);
    }
  } else {
    // Payment flow — just give the URL
    console.log(`\n  Visit ${dim("https://starkbot.cloud")} to pay with crypto.`);
    console.log(`  After payment, run ${dim("`starkbot status`")} to verify.\n`);
  }
}
