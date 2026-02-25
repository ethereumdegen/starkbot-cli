import { createInterface } from "node:readline";
import { requireCredentials } from "../lib/credentials.js";
import { GatewayClient, type SseEvent } from "../lib/gateway-client.js";
import { prefix, printError, dim, info } from "../lib/ui.js";

function requireGateway() {
  const creds = requireCredentials();
  if (!creds.gateway_token || !creds.instance_domain) {
    throw new Error(
      "Gateway not configured. Run `starkbot connect` first."
    );
  }
  return new GatewayClient(
    `https://${creds.instance_domain}`,
    creds.gateway_token
  );
}

function printSseEvent(event: SseEvent) {
  switch (event.type) {
    case "tool_call": {
      const name = event.tool_name ?? "unknown";
      process.stdout.write(dim(`[${name}...] `));
      break;
    }
    case "tool_result":
      // Silently consume
      break;
    case "text":
      if (event.content) {
        process.stdout.write(event.content);
      }
      break;
    case "done":
      break;
  }
}

/** One-shot message mode */
export async function chatOneShotCommand(message: string) {
  const gw = requireGateway();

  process.stdout.write(`${prefix.agent} `);
  try {
    await gw.chatStream(message, printSseEvent);
    console.log();
  } catch (err: any) {
    console.log();
    printError(err.message);
    process.exit(1);
  }
}

/** Interactive REPL mode */
export async function chatReplCommand() {
  const gw = requireGateway();

  console.log(
    dim(
      "Starkbot CLI — type a message, /new to reset, /sessions to list, /quit to exit"
    )
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = () => {
    rl.question(`${prefix.you} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      switch (trimmed) {
        case "/quit":
        case "/exit":
        case "/q":
          rl.close();
          console.log(dim("Goodbye!"));
          return;

        case "/new": {
          try {
            const resp = await gw.newSession();
            console.log(
              `${prefix.system} New session created (id: ${resp.session_id})`
            );
          } catch (err: any) {
            console.log(`${prefix.error} ${err.message}`);
          }
          prompt();
          return;
        }

        case "/sessions": {
          try {
            const resp = await gw.listSessions();
            if (resp.sessions.length === 0) {
              console.log(`${prefix.system} No sessions found`);
            } else {
              console.log(`${prefix.system} Sessions:`);
              for (const s of resp.sessions) {
                console.log(
                  `  ${info(s.session_key)} | ${s.message_count} msgs | last active: ${dim(s.last_activity_at)}`
                );
              }
            }
          } catch (err: any) {
            console.log(`${prefix.error} ${err.message}`);
          }
          prompt();
          return;
        }

        case "/help":
          console.log(`${prefix.system} Commands:`);
          console.log(`  ${info("/new")}      — Start a new session`);
          console.log(`  ${info("/sessions")} — List sessions`);
          console.log(
            `  ${info("/history <id>")} — Show message history`
          );
          console.log(`  ${info("/quit")}     — Exit`);
          prompt();
          return;

        default:
          if (trimmed.startsWith("/history")) {
            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) {
              console.log(
                `${prefix.system} Usage: /history <session_id>`
              );
            } else {
              const sid = parseInt(parts[1], 10);
              if (isNaN(sid)) {
                console.log(`${prefix.error} Invalid session ID: ${parts[1]}`);
              } else {
                try {
                  const resp = await gw.getHistory(sid);
                  for (const m of resp.messages) {
                    const p =
                      m.role === "user"
                        ? prefix.you
                        : m.role === "assistant"
                          ? prefix.agent
                          : dim(`${m.role}>`);
                    console.log(`${p} ${m.content}`);
                  }
                } catch (err: any) {
                  console.log(`${prefix.error} ${err.message}`);
                }
              }
            }
            prompt();
            return;
          }

          // Send message with streaming
          process.stdout.write(`${prefix.agent} `);
          try {
            await gw.chatStream(trimmed, printSseEvent);
            console.log();
          } catch (err: any) {
            console.log();
            console.log(`${prefix.error} ${err.message}`);
          }
          prompt();
      }
    });
  };

  prompt();

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    process.exit(0);
  });
}
