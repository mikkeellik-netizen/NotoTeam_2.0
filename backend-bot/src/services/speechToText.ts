import { spawn } from "node:child_process";

export interface SpeechToTextProvider {
  transcribe(filePath: string): Promise<string>;
}

export class DisabledSpeechToTextProvider implements SpeechToTextProvider {
  async transcribe(): Promise<string> {
    throw new Error(
      "Voice recognition is not configured. Set SPEECH_TO_TEXT_COMMAND or VOICE_TRANSCRIPT_MOCK_TEXT.",
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

export function createSpeechToTextProvider(env = process.env): SpeechToTextProvider {
  if (env.VOICE_TRANSCRIPT_MOCK_TEXT) {
    return new MockSpeechToTextProvider(env.VOICE_TRANSCRIPT_MOCK_TEXT);
  }

  if (env.SPEECH_TO_TEXT_COMMAND) {
    return new CommandSpeechToTextProvider(env.SPEECH_TO_TEXT_COMMAND);
  }

  return new DisabledSpeechToTextProvider();
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
