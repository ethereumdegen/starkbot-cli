import ora, { type Ora } from "ora";
import chalk from "chalk";
import type { SseEvent } from "./gateway-client.js";

const subtypeColor = chalk.hex("#7C3AED").bold;
const toolColor = chalk.yellow;
const subagentColor = chalk.cyan;
const dimText = chalk.dim;

export class StatusTracker {
  private spinner: Ora;
  private activeSubtype = "";
  private activeTools: string[] = [];
  private activeSubagents = new Map<string, string>(); // label -> subtype
  private paused = false;

  constructor() {
    this.spinner = ora({ color: "magenta", spinner: "dots", discardStdin: false });
  }

  handleEvent(event: SseEvent) {
    switch (event.type) {
      case "tool_call":
        this.addTool(event.tool_name ?? "unknown");
        break;
      case "tool_result":
        this.removeTool(event.tool_name ?? "unknown");
        break;
      case "subagent_spawned":
        this.addSubagent(event.label ?? "?", event.agent_subtype);
        break;
      case "subagent_completed":
      case "subagent_failed":
        this.removeSubagent(event.label ?? "?");
        break;
      case "subtype_change":
        this.setSubtype(event.agent_subtype ?? event.label ?? "");
        break;
      case "thinking":
        this.setThinking(event.content);
        break;
      case "task_started":
        if (event.task_name) this.setTask(event.task_name);
        break;
      case "task_completed":
        this.updateSpinner();
        break;
      case "text":
        this.pauseForText();
        if (event.content) process.stdout.write(event.content);
        this.resumeAfterText();
        break;
      case "done":
        this.finish();
        break;
    }
  }

  private prefix(): string {
    if (this.activeSubtype) {
      return `${subtypeColor(`[${this.activeSubtype}]`)} `;
    }
    return "";
  }

  private addTool(name: string) {
    if (!this.activeTools.includes(name)) {
      this.activeTools.push(name);
    }
    this.updateSpinner();
  }

  private removeTool(name: string) {
    this.activeTools = this.activeTools.filter((t) => t !== name);
    this.updateSpinner();
  }

  private addSubagent(label: string, subtype?: string) {
    this.activeSubagents.set(label, subtype ?? "");
    this.updateSpinner();
  }

  private removeSubagent(label: string) {
    this.activeSubagents.delete(label);
    this.updateSpinner();
  }

  private setSubtype(subtype: string) {
    this.activeSubtype = subtype;
    this.updateSpinner();
  }

  private setThinking(message?: string) {
    const text = `${this.prefix()}${dimText(message || "thinking...")}`;
    this.ensureSpinning(text);
  }

  private setTask(taskName: string) {
    const text = `${this.prefix()}${dimText(taskName)}`;
    this.ensureSpinning(text);
  }

  private updateSpinner() {
    const parts: string[] = [];

    // Show active subagents
    for (const [label, subtype] of this.activeSubagents) {
      const st = subtype ? ` (${subtype})` : "";
      parts.push(subagentColor(`subagent "${label}"${st} running`));
    }

    // Show active tools
    if (this.activeTools.length > 0) {
      const names = this.activeTools.map((t) => toolColor(t)).join(", ");
      parts.push(`calling ${names}`);
    }

    if (parts.length === 0) {
      // Nothing active — stop spinner if no text is being shown
      if (this.spinner.isSpinning && !this.paused) {
        this.spinner.stop();
      }
      return;
    }

    const text = `${this.prefix()}${parts.join(" | ")}`;
    this.ensureSpinning(text);
  }

  private ensureSpinning(text: string) {
    if (this.paused) return;
    if (this.spinner.isSpinning) {
      this.spinner.text = text;
    } else {
      this.spinner.start(text);
    }
  }

  pauseForText() {
    if (this.spinner.isSpinning) {
      this.spinner.stop();
    }
    this.paused = true;
  }

  resumeAfterText() {
    this.paused = false;
    // Re-show spinner if there's still active work
    if (this.activeTools.length > 0 || this.activeSubagents.size > 0) {
      this.updateSpinner();
    }
  }

  finish() {
    if (this.spinner.isSpinning) {
      this.spinner.stop();
    }
    this.activeTools = [];
    this.activeSubagents.clear();
    this.activeSubtype = "";
    this.paused = false;
  }
}
