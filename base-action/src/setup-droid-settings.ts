import { homedir } from "os";
import { dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

type Settings = Record<string, unknown>;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSettingsObject(raw: string, sourceLabel: string): Settings {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceLabel} must contain valid JSON: ${errorMessage(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must be a JSON object`);
  }

  return parsed as Settings;
}

function isJsonLikeInput(input: string): boolean {
  return (
    input.startsWith("{") ||
    input.startsWith("[") ||
    input.startsWith('"') ||
    input === "null" ||
    input === "true" ||
    input === "false" ||
    /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input)
  );
}

async function readSettingsFile(
  path: string,
  foundMessage: string,
  missingMessage: string,
): Promise<Settings> {
  try {
    const existingSettings = await readFile(path, "utf-8");
    if (existingSettings.trim()) {
      console.log(foundMessage);
      return parseSettingsObject(existingSettings, path);
    }

    console.log(`Settings file exists but is empty`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      console.log(missingMessage);
      return {};
    }

    throw error;
  }

  return {};
}

async function writeSettingsFile(path: string, settings: Settings) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

async function parseSettingsInput(settingsInput: string): Promise<Settings> {
  const trimmedInput = settingsInput.trim();

  try {
    const inputSettings = parseSettingsObject(settingsInput, "settings input");
    console.log(`Parsed settings input as JSON`);
    return inputSettings;
  } catch (jsonError) {
    if (isJsonLikeInput(trimmedInput)) {
      throw new Error(
        `Failed to parse settings input as JSON: ${errorMessage(jsonError)}`,
      );
    }

    console.log(`Settings input is not JSON, treating as file path`);
    try {
      const fileContent = await readFile(settingsInput, "utf-8");
      const inputSettings = parseSettingsObject(
        fileContent,
        `settings file ${settingsInput}`,
      );
      console.log(`Successfully read and parsed settings from file`);
      return inputSettings;
    } catch (fileError) {
      throw new Error(
        `Failed to read or parse settings file: ${errorMessage(fileError)}`,
      );
    }
  }
}

export async function setupDroidSettings(
  settingsInput?: string,
  homeDir?: string,
) {
  const home = homeDir ?? homedir();
  const settingsDir = `${home}/.factory/droid`;
  const settingsPath = `${settingsDir}/settings.json`;
  console.log(`Setting up Droid settings at: ${settingsPath}`);

  // Ensure settings directory exists
  console.log(`Creating Droid settings directory...`);
  await mkdir(settingsDir, { recursive: true });

  let settings = await readSettingsFile(
    settingsPath,
    `Found existing settings file`,
    `No existing settings file found, creating new one`,
  );

  // Handle settings input (either file path or JSON string)
  if (settingsInput && settingsInput.trim()) {
    console.log(`Processing settings input...`);
    const inputSettings = await parseSettingsInput(settingsInput);

    // Merge input settings with existing settings
    settings = {
      ...settings,
      ...inputSettings,
    };
    console.log(`Merged settings with input settings`);
  }

  // Always set enableAllProjectMcpServers to true
  settings.enableAllProjectMcpServers = true;
  console.log(`Updated settings with enableAllProjectMcpServers: true`);

  await writeSettingsFile(settingsPath, settings);
  console.log(`Settings saved successfully`);
}
