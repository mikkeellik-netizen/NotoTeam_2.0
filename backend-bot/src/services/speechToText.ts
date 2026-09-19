import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface SpeechToTextProvider {
  transcribe(filePath: string): Promise<string>;
}

export class DisabledSpeechToTextProvider implements SpeechToTextProvider {
  async transcribe(): Promise<string> {
    throw new Error(
      "Voice recognition is not configured. Set SPEECH_TO_TEXT_URL, SPEECH_TO_TEXT_COMMAND or VOICE_TRANSCRIPT_MOCK_TEXT.",
    );
  }
}

export class MockSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private text: string) {}

  async transcribe(): Promise<string> {
    return this.text;
  }
}

export class CommandSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private commandTemplate: string) {}

  async transcribe(filePath: string): Promise<string> {
    const command = this.commandTemplate.includes("{file}")
      ? this.commandTemplate.replaceAll("{file}", quoteShellArg(filePath))
      : `${this.commandTemplate} ${quoteShellArg(filePath)}`;

    const output = await runCommand(command);
    const text = output.trim();
    if (!text) throw new Error("Speech-to-text command returned empty text.");
    return text;
  }
}

export class HttpSpeechToTextProvider implements SpeechToTextProvider {
  constructor(
    private baseUrl: string,
    private timeoutMs: number,
  ) {}

  async transcribe(filePath: string): Promise<string> {
    const audio = await readFile(filePath);
    const body = new FormData();
    body.set("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "voice.ogg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/transcribe`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const details = (await response.text()).slice(0, 500);
        throw new Error(`Speech service returned ${response.status}: ${details}`);
      }

      const payload = (await response.json()) as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) throw new Error("Speech service returned empty text.");
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Speech recognition timed out after ${this.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSpeechToTextProvider(env = process.env): SpeechToTextProvider {
  if (env.VOICE_TRANSCRIPT_MOCK_TEXT) {
    return new MockSpeechToTextProvider(env.VOICE_TRANSCRIPT_MOCK_TEXT);
  }

  if (env.SPEECH_TO_TEXT_COMMAND) {
    return new CommandSpeechToTextProvider(env.SPEECH_TO_TEXT_COMMAND);
  }

  if (env.SPEECH_TO_TEXT_URL?.trim()) {
    const timeoutMs = positiveInteger(env.SPEECH_TRANSCRIPTION_TIMEOUT_MS, 120_000);
    return new HttpSpeechToTextProvider(env.SPEECH_TO_TEXT_URL.trim(), timeoutMs);
  }

  return new DisabledSpeechToTextProvider();
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runCommand(command: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, { shell: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Speech-to-text command exited with code ${code}`));
    });
  });
}

function quoteShellArg(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
