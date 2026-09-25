import { createInterface } from 'node:readline';

/** Ask a question on the terminal; `hidden` keeps passwords off the screen and out of scrollback. */
export function prompt(question: string, { hidden = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const output = rl as unknown as { _writeToOutput: (text: string) => void };
      let asked = false;
      output._writeToOutput = (text: string) => {
        // Print the question once, then swallow the echoed characters.
        if (!asked) {
          process.stdout.write(text);
          asked = true;
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}
