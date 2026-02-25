import { clearCredentials, loadCredentials } from "../lib/credentials.js";
import { printSuccess, dim } from "../lib/ui.js";

export async function logoutCommand() {
  const creds = loadCredentials();
  clearCredentials();

  if (creds) {
    printSuccess(`Logged out from @${creds.username}`);
  } else {
    console.log(dim("No credentials stored."));
  }
}
