/**
 * `starkbot dashboard [module]` — View a module's TUI dashboard.
 *
 * Fetches ANSI-rendered dashboard from the module via the gateway proxy
 * and displays it in the terminal. In interactive mode (default when TTY),
 * captures keyboard input for navigation and actions.
 */

import * as readline from "node:readline";
import { requireCredentials, getInstanceUrl } from "../lib/credentials.js";
import { printError, dim, bold, info } from "../lib/ui.js";

interface ModuleInfo {
  name: string;
  description: string;
  has_dashboard: boolean;
  dashboard_style: string | null;
  enabled: boolean;
}

interface ActionDef {
  key: string;
  label: string;
  action: string;
  confirm?: boolean;
  prompts?: string[];
}

interface ActionsMetadata {
  navigable: boolean;
  actions: ActionDef[];
}

interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchModules(baseUrl: string, token: string): Promise<ModuleInfo[]> {
  const resp = await fetch(`${baseUrl}/api/modules`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to list modules: HTTP ${resp.status}`);
  return resp.json() as Promise<ModuleInfo[]>;
}

async function fetchTuiDashboard(
  baseUrl: string,
  token: string,
  moduleName: string,
  width: number,
  height: number,
  state?: { selected: number; scroll: number },
): Promise<string> {
  let url = `${baseUrl}/api/modules/${moduleName}/proxy/rpc/dashboard/tui?width=${width}&height=${height}`;
  if (state) {
    url += `&selected=${state.selected}&scroll=${state.scroll}`;
  }
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Failed to fetch dashboard: HTTP ${resp.status} ${text}`);
  }
  return resp.text();
}

async function fetchActions(
  baseUrl: string,
  token: string,
  moduleName: string,
): Promise<ActionsMetadata> {
  const url = `${baseUrl}/api/modules/${moduleName}/proxy/rpc/dashboard/tui/actions`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { navigable: false, actions: [] };
  return resp.json() as Promise<ActionsMetadata>;
}

async function postAction(
  baseUrl: string,
  token: string,
  moduleName: string,
  action: string,
  state: { selected: number; scroll: number },
  inputs?: string[],
): Promise<ActionResult> {
  const url = `${baseUrl}/api/modules/${moduleName}/proxy/rpc/dashboard/tui/action`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, state, inputs }),
  });
  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
  return resp.json() as Promise<ActionResult>;
}

// ---------------------------------------------------------------------------
// Readline prompt helper
// ---------------------------------------------------------------------------

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function dashboardCommand(
  moduleName?: string,
  opts?: { watch?: string | boolean },
) {
  const creds = requireCredentials();
  const baseUrl = getInstanceUrl(creds);
  const token = creds.gateway_token ?? creds.jwt;

  if (!moduleName) {
    const modules = await fetchModules(baseUrl, token);
    const tuiModules = modules.filter((m) => m.dashboard_style === "tui" && m.enabled);

    if (tuiModules.length === 0) {
      console.log(dim("No modules with TUI dashboards found."));
      return;
    }

    console.log(bold("\nModules with TUI dashboards:\n"));
    for (const m of tuiModules) {
      console.log(`  ${info(m.name)}  ${dim(m.description)}`);
    }
    console.log(dim(`\nUsage: starkbot dashboard <module-name>\n`));
    return;
  }

  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;

  // Non-interactive fallback (not a TTY or explicit --watch with no interaction)
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (!isTTY) {
    const ansi = await fetchTuiDashboard(baseUrl, token, moduleName, width, height);
    process.stdout.write(ansi);
    return;
  }

  // ---------------------------------------------------------------------------
  // Interactive mode
  // ---------------------------------------------------------------------------

  const meta = await fetchActions(baseUrl, token, moduleName);
  const keyMap = new Map<string, ActionDef>();
  for (const a of meta.actions) {
    keyMap.set(a.key, a);
  }

  let selected = 0;
  let scroll = 0;
  let running = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const render = async () => {
    try {
      const ansi = await fetchTuiDashboard(baseUrl, token, moduleName, width, height, {
        selected,
        scroll,
      });
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(ansi);
    } catch (err: any) {
      cleanup();
      printError(err.message);
      process.exit(1);
    }
  };

  const cleanup = () => {
    running = false;
    if (refreshTimer) clearInterval(refreshTimer);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners("data");
    process.stdout.write("\x1b[2J\x1b[H");
  };

  // Enter raw mode
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Initial render
  await render();

  // Auto-refresh
  const refreshInterval =
    opts?.watch !== undefined
      ? (typeof opts.watch === "string" ? parseInt(opts.watch, 10) : 5)
      : 5;
  const refreshMs = (isNaN(refreshInterval) || refreshInterval < 1 ? 5 : refreshInterval) * 1000;
  refreshTimer = setInterval(async () => {
    if (running) await render();
  }, refreshMs);

  // Keypress handler
  process.stdin.on("data", async (key: string) => {
    if (!running) return;

    // Ctrl+C
    if (key === "\x03") {
      cleanup();
      process.exit(0);
      return;
    }

    // q to quit
    if (key === "q") {
      cleanup();
      process.exit(0);
      return;
    }

    // Arrow keys (escape sequences)
    if (key === "\x1b[A") {
      // Up
      if (meta.navigable && selected > 0) {
        selected--;
        if (selected < scroll) scroll = selected;
        await render();
      }
      return;
    }
    if (key === "\x1b[B") {
      // Down
      if (meta.navigable) {
        selected++;
        // Server will clamp if over max
        if (selected >= scroll + 20) scroll++;
        await render();
      }
      return;
    }

    // Page Up / Page Down
    if (key === "\x1b[5~") {
      if (meta.navigable) {
        selected = Math.max(0, selected - 20);
        scroll = Math.max(0, scroll - 20);
        await render();
      }
      return;
    }
    if (key === "\x1b[6~") {
      if (meta.navigable) {
        selected += 20;
        scroll += 20;
        await render();
      }
      return;
    }

    // Action keys
    const actionDef = keyMap.get(key);
    if (actionDef) {
      let inputs: string[] | undefined;

      // Handle prompts — temporarily exit raw mode
      if (actionDef.prompts && actionDef.prompts.length > 0) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        inputs = [];
        for (const prompt of actionDef.prompts) {
          const answer = await promptUser(`  ${prompt} `);
          inputs.push(answer);
        }
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }

      // Handle confirm
      if (actionDef.confirm) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const answer = await promptUser(`  Confirm ${actionDef.label}? (y/N) `);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        if (answer.toLowerCase() !== "y") {
          await render();
          return;
        }
      }

      const result = await postAction(baseUrl, token, moduleName, actionDef.action, {
        selected,
        scroll,
      }, inputs);

      if (!result.ok && result.error) {
        // Flash error briefly at bottom
        process.stdout.write(`\n  \x1b[31mError: ${result.error}\x1b[0m`);
        await new Promise((r) => setTimeout(r, 1500));
      }

      await render();
      return;
    }
  });
}
