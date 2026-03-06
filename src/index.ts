import type { Plugin } from '@opencode-ai/plugin';

type Terminal = 'iterm2' | 'wezterm' | 'windows-terminal';

function detectTerminal(): Terminal | undefined {
  const env = process.env;
  if (
    env['TERM_PROGRAM'] === 'iTerm.app' ||
    env['LC_TERMINAL'] === 'iTerm2' ||
    env['ITERM_SESSION_ID']
  ) {
    return 'iterm2';
  }
  if (env['TERM_PROGRAM'] === 'WezTerm' || env['WEZTERM_EXECUTABLE']) {
    return 'wezterm';
  }
  if (env['WT_SESSION']) {
    return 'windows-terminal';
  }
  return undefined;
}

function osc(payload: string): void {
  const esc = process.env['TMUX']
    ? `\x1bPtmux;\x1b\x1b]${payload}\x07\x1b\\`
    : `\x1b]${payload}\x07`;
  process.stdout.write(esc);
}

function progress(code: string): void {
  osc(`9;4;${code}`);
}

export const TerminalProgressPlugin: Plugin = async () => {
  const terminal = detectTerminal();
  if (!terminal) return {};

  return {
    event: async ({ event }) => {
      if (event.type === 'session.status') {
        const { status } = event.properties;
        if (status.type === 'busy') {
          progress('3');
        } else if (status.type === 'idle') {
          progress('0');
        }
      } else if (event.type === 'session.error') {
        progress('2');
      }
    },
    'permission.ask': async () => {
      progress('4;50');
    },
    'tool.execute.before': async (input) => {
      if (input.tool === 'question') {
        progress('4;50');
      }
    },
  };
};
