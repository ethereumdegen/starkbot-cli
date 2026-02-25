import chalk from "chalk";
import ora, { type Ora } from "ora";

export const brand = chalk.hex("#7C3AED"); // Purple accent
export const success = chalk.green;
export const error = chalk.red;
export const warn = chalk.yellow;
export const dim = chalk.dim;
export const info = chalk.cyan;
export const bold = chalk.bold;

export const prefix = {
  you: chalk.green.bold("you>"),
  agent: chalk.cyan.bold("agent>"),
  system: chalk.blue.bold("system>"),
  error: chalk.red.bold("error>"),
};

export function banner() {
  console.log(brand.bold("\n  ⚡ Starkbot CLI\n"));
}

export function spinner(text: string): Ora {
  return ora({ text, color: "magenta" });
}

export function printError(msg: string) {
  console.error(`${error.bold("Error:")} ${msg}`);
}

export function printSuccess(msg: string) {
  console.log(`${success("✓")} ${msg}`);
}

export function printWarning(msg: string) {
  console.log(`${warn("!")} ${msg}`);
}

export function printKeyValue(key: string, value: string | undefined | null) {
  console.log(`  ${dim(key + ":")} ${value ?? dim("—")}`);
}
