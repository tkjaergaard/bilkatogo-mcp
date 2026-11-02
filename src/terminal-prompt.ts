// The CLI's prompts on a real terminal: questions go to stderr, so stdout
// carries only the command's result. A secret is read in raw mode without
// echoing it. When stdin isn't a terminal (piped input), each answer is the
// next line.

import { createInterface } from "node:readline";
import type { Prompt } from "./cli.ts";

/** The prompts, and `close` to let go of stdin once the command is done. */
export function terminalPrompt(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): Prompt & { close(): void } {
  if (!input.isTTY) {
    // Opened on the first question only: an open reader keeps the process alive.
    let reader: ReturnType<typeof createInterface> | undefined;
    let lines: AsyncIterator<string> | undefined;
    const next = async (question: string) => {
      output.write(question);
      reader ??= createInterface({ input });
      lines ??= reader[Symbol.asyncIterator]();
      const line = await lines.next();
      output.write("\n");
      return line.done ? "" : line.value;
    };
    return { text: next, secret: next, close: () => reader?.close() };
  }
  return {
    close() {},
    async text(question) {
      const rl = createInterface({ input, output, terminal: true });
      try {
        return await new Promise<string>((resolve) => rl.question(question, resolve));
      } finally {
        rl.close();
      }
    },
    secret: (question) => readHidden(input, output, question),
  };
}

/** Reads one line in raw mode, echoing nothing. Ctrl-C exits as it would at any prompt. */
function readHidden(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  question: string,
): Promise<string> {
  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve) => {
    let answer = "";
    const done = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          done();
          resolve(answer);
          return;
        }
        if (char === "\u0003") {
          done();
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") answer = answer.slice(0, -1);
        else if (char >= " ") answer += char;
      }
    };
    input.on("data", onData);
  });
}
