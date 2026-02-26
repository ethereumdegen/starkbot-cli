import { Command } from "commander";
import { printError } from "./lib/ui.js";

const program = new Command();

program
  .name("starkbot")
  .description("CLI for Starkbot — login, provision, and chat with your bot")
  .version("0.3.1")
  .addHelpCommand("help", "Show help for a command");

program
  .command("login")
  .description("Login with X or connect to an external instance")
  .action(async () => {
    const { loginCommand } = await import("./commands/login.js");
    await loginCommand();
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(async () => {
    const { logoutCommand } = await import("./commands/logout.js");
    await logoutCommand();
  });

program
  .command("status")
  .description("Show account, subscription, and instance status")
  .action(async () => {
    const { statusCommand } = await import("./commands/status.js");
    await statusCommand();
  });

program
  .command("subscribe")
  .description("Claim trial, redeem voucher, or subscribe")
  .action(async () => {
    const { subscribeCommand } = await import("./commands/subscribe.js");
    await subscribeCommand();
  });

program
  .command("provision")
  .description("Provision your Starkbot instance")
  .action(async () => {
    const { provisionCommand } = await import("./commands/provision.js");
    await provisionCommand();
  });

program
  .command("connect")
  .description("Fetch gateway token and test connection")
  .option("-t, --token <token>", "Manually provide a gateway token (for existing instances)")
  .option("-d, --domain <domain>", "Instance domain (e.g. mybot-abc123.starkbot.cloud)")
  .action(async (opts: { token?: string; domain?: string }) => {
    const { connectCommand } = await import("./commands/connect.js");
    await connectCommand(opts);
  });

program
  .command("chat [message]")
  .description("Chat with your bot (REPL or one-shot)")
  .action(async (message?: string) => {
    const { chatOneShotCommand, chatReplCommand } = await import(
      "./commands/chat.js"
    );
    if (message) {
      await chatOneShotCommand(message);
    } else {
      await chatReplCommand();
    }
  });

// ==================== Module Management ====================

const modules = program
  .command("modules")
  .description("List and connect to module TUI dashboards")
  .addHelpCommand("help", "Show help for module commands");

modules
  .command("list")
  .description("List installed modules")
  .action(async () => {
    const { modulesListCommand } = await import("./commands/modules.js");
    await modulesListCommand();
  });

modules
  .command("connect <name>")
  .description("Connect to a module's TUI dashboard")
  .action(async (name: string) => {
    const { modulesConnectCommand } = await import("./commands/modules.js");
    await modulesConnectCommand(name);
  });

// Default: `starkbot modules` with no subcommand → list
modules.action(async () => {
  const { modulesListCommand } = await import("./commands/modules.js");
  await modulesListCommand();
});

// ==================== Instance Management ====================

const instances = program
  .command("instances")
  .description("Manage your Starkbot instances")
  .addHelpCommand("help", "Show help for instance commands");

instances
  .command("list")
  .description("List all your instances")
  .action(async () => {
    const { instancesListCommand } = await import("./commands/instances.js");
    await instancesListCommand();
  });

instances
  .command("new")
  .description("Create a new instance")
  .option("-n, --name <name>", "Display name for the instance")
  .action(async (opts: { name?: string }) => {
    const { instancesNewCommand } = await import("./commands/instances.js");
    await instancesNewCommand(opts);
  });

instances
  .command("select [tenant-id]")
  .description("Select the active instance")
  .action(async (tenantId?: string) => {
    const { instancesSelectCommand } = await import("./commands/instances.js");
    await instancesSelectCommand(tenantId);
  });

instances
  .command("delete [tenant-id]")
  .description("Delete a deprovisioned instance")
  .action(async (tenantId?: string) => {
    const { instancesDeleteCommand } = await import("./commands/instances.js");
    await instancesDeleteCommand(tenantId);
  });

// Default: `starkbot instances` with no subcommand → list
instances.action(async () => {
  const { instancesListCommand } = await import("./commands/instances.js");
  await instancesListCommand();
});

// ==================== Dashboards ====================

program
  .command("dashboard [module]")
  .description("View a module's TUI dashboard")
  .option("-w, --watch [seconds]", "Auto-refresh interval (default: 5s)")
  .action(async (module?: string, opts?: { watch?: string | boolean }) => {
    const { dashboardCommand } = await import("./commands/dashboard.js");
    await dashboardCommand(module, opts);
  });

// ==================== Sessions ====================

program
  .command("sessions")
  .description("List chat sessions")
  .action(async () => {
    const { sessionsCommand } = await import("./commands/sessions.js");
    await sessionsCommand();
  });

program
  .command("history <session-id>")
  .description("Show message history for a session")
  .action(async (sessionId: string) => {
    const { historyCommand } = await import("./commands/history.js");
    await historyCommand(sessionId);
  });

// Default: no subcommand → guided wizard
program.action(async () => {
  const { wizardCommand } = await import("./commands/wizard.js");
  await wizardCommand();
});

// Global error handler
program.parseAsync(process.argv).catch((err) => {
  printError(err.message);
  process.exit(1);
});
