/**
 * `starkbot modules` — List and connect to module TUI dashboards via the gateway API.
 */

import * as readline from "node:readline";
import { requireCredentials, getInstanceUrl } from "../lib/credentials.js";
import { GatewayClient } from "../lib/gateway-client.js";
import { printError, dim, bold, info, prefix } from "../lib/ui.js";

function requireGateway() {
  const creds = requireCredentials();
  if (!creds.gateway_token || !creds.instance_domain) {
    throw new Error("Gateway not configured. Run `starkbot connect` first.");
  }
  return new GatewayClient(getInstanceUrl(creds), creds.gateway_token);
}

// ---------------------------------------------------------------------------
// modules list
// ---------------------------------------------------------------------------

export async function modulesListCommand() {
  const gw = requireGateway();

  try {
    const resp = await gw.listModules();
    if (resp.modules.length === 0) {
      console.log(dim("No modules installed."));
      return;
    }

    console.log(bold("\nInstalled modules:\n"));
    console.log(
      `  ${dim("NAME".padEnd(20))} ${dim("VERSION".padEnd(10))} ${dim("TUI".padEnd(5))} ${dim("DESCRIPTION")}`
    );
    console.log(dim("  " + "-".repeat(68)));

    for (const m of resp.modules) {
      const tui = m.has_tui ? info("yes") : dim("no ");
      console.log(
        `  ${m.name.padEnd(20)} ${dim(m.version.padEnd(10))} ${tui.padEnd(5)} ${dim(m.description)}`
      );
    }
    console.log();
  } catch (err: any) {
    printError(err.message);
  }
}

// ---------------------------------------------------------------------------
// modules connect — interactive TUI via gateway
// ---------------------------------------------------------------------------

interface ActionDef {
  key: string;
  label: string;
  action: string;
  confirm?: boolean;
  prompts?: string[];
}

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

export async function modulesConnectCommand(moduleName: string) {
  const gw = requireGateway();

  // Verify module exists and has TUI
  const { modules } = await gw.listModules();
  const mod = modules.find((m) => m.name === moduleName);
  if (!mod) {
    printError(`Module '${moduleName}' not found. Run \`starkbot modules list\` to see available modules.`);
    return;
  }
  if (!mod.has_tui) {
    printError(`Module '${moduleName}' does not have a TUI dashboard.`);
    return;
  }

  const width = process.stdout.columns || 120;
  const height = (process.stdout.rows || 40) - 1; // leave room for status bar

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Non-interactive: just print one frame
    try {
      const { ansi } = await gw.fetchTuiFrame(moduleName, width, height);
      process.stdout.write(ansi);
    } catch (err: any) {
      printError(err.message);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // Interactive TUI mode
  // ---------------------------------------------------------------------------

  let selected = 0;
  let scroll = 0;
  let running = true;
  let actions: ActionDef[] = [];
  const keyMap = new Map<string, ActionDef>();

  const render = async () => {
    try {
      const frame = await gw.fetchTuiFrame(moduleName, width, height, { selected, scroll });
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(frame.ansi);

      if (frame.actions) {
        actions = frame.actions as ActionDef[];
        keyMap.clear();
        for (const a of actions) {
          keyMap.set(a.key, a);
        }
      }
    } catch (err: any) {
      cleanup();
      printError(err.message);
      process.exit(1);
    }
  };

  const cleanup = () => {
    running = false;
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

  // SSE push listener for live updates
  let sseAbort: AbortController | null = null;
  const startSseListener = () => {
    sseAbort = new AbortController();
    const url = `${getInstanceUrl(requireCredentials())}/api/gateway/modules/${moduleName}/tui/stream?width=${width}&height=${height}`;
    const creds = requireCredentials();
    const token = creds.gateway_token ?? creds.jwt;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: sseAbort.signal,
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) return;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let skipFirst = true;

        while (running) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let pos: number;
          while ((pos = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, pos);
            buffer = buffer.slice(pos + 2);

            let eventName = "";
            const dataLines: string[] = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
            }

            if (eventName === "tui_frame") {
              if (skipFirst) {
                skipFirst = false;
                continue;
              }
              try {
                const data = JSON.parse(dataLines.join("\n"));
                process.stdout.write("\x1b[2J\x1b[H");
                process.stdout.write(data.ansi ?? "");
                if (data.actions) {
                  actions = data.actions;
                  keyMap.clear();
                  for (const a of actions) keyMap.set(a.key, a);
                }
              } catch {
                // skip malformed
              }
            }
          }
        }
      })
      .catch(() => {
        // SSE connection ended or aborted — that's fine
      });
  };

  startSseListener();

  // Keypress handler
  process.stdin.on("data", async (key: string) => {
    if (!running) return;

    // Ctrl+C or q to quit
    if (key === "\x03" || key === "q") {
      cleanup();
      sseAbort?.abort();
      console.log(dim("Back to shell."));
      process.exit(0);
      return;
    }

    // Esc
    if (key === "\x1b" || key === "\x1b\x1b") {
      cleanup();
      sseAbort?.abort();
      console.log(dim("Back to shell."));
      process.exit(0);
      return;
    }

    // Arrow Up
    if (key === "\x1b[A") {
      if (selected > 0) {
        selected--;
        if (selected < scroll) scroll = selected;
        await render();
      }
      return;
    }

    // Arrow Down
    if (key === "\x1b[B") {
      selected++;
      if (selected >= scroll + 20) scroll++;
      await render();
      return;
    }

    // Page Up
    if (key === "\x1b[5~") {
      selected = Math.max(0, selected - 20);
      scroll = Math.max(0, scroll - 20);
      await render();
      return;
    }

    // Page Down
    if (key === "\x1b[6~") {
      selected += 20;
      scroll += 20;
      await render();
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

      const result = await gw.postTuiAction(
        moduleName,
        actionDef.action,
        { selected, scroll },
        inputs,
      );

      if (!result.ok && result.error) {
        process.stdout.write(`\n  \x1b[31mError: ${result.error}\x1b[0m`);
        await new Promise((r) => setTimeout(r, 1500));
      }

      await render();
      return;
    }
  });
}
