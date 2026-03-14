import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CliArgs, CliConfig } from "./types.ts";

/**
 * Parse CLI arguments with a script-specific configuration.
 * Handles --radius, --output, --help, and the positional input file.
 */
export function parseArgs(config: CliConfig): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
${config.scriptName} - ${config.description}

Usage:
  node ${config.scriptName}.ts <input.gpx> [options]

Options:
  --radius <meters>   Search radius from route (default: ${config.defaultRadius})
  --output <file>     Output GPX file (default: <input>${config.defaultSuffix}.gpx)
  --help, -h          Show this help message

Examples:
  node ${config.scriptName}.ts route.gpx
  node ${config.scriptName}.ts route.gpx --radius ${Math.round(config.defaultRadius / 2)}
  node ${config.scriptName}.ts route.gpx --output custom-output.gpx
`);
    process.exit(0);
  }

  let inputFile = "";
  let radius = config.defaultRadius;
  let outputFile = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--radius" && args[i + 1]) {
      radius = parseInt(args[i + 1], 10);
      if (isNaN(radius) || radius <= 0) {
        console.error("Error: --radius must be a positive number");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      inputFile = args[i];
    }
  }

  if (!inputFile) {
    console.error("Error: No input GPX file specified");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  if (!outputFile) {
    const base = basename(inputFile, ".gpx");
    const dir = dirname(inputFile);
    outputFile = join(dir, `${base}${config.defaultSuffix}.gpx`);
  }

  return { inputFile, radius, outputFile };
}
