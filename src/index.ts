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

function createOsc(): (payload: string) => void {
  const inTmux = !!process.env['TMUX'];
  return (payload: string) => {
    const esc = inTmux ? `\x1bPtmux;\x1b\x1b]${payload}\x07\x1b\\` : `\x1b]${payload}\x07`;
    process.stderr.write(esc);
  };
}

export const TerminalProgressPlugin: Plugin = async () => {
  if (!detectTerminal()) return {};

  const osc = createOsc();

  let waitingForInput = false;

  function progress(code: string): void {
    osc(`9;4;${code}`);
  }

  function pause(): void {
    waitingForInput = true;
    progress('4;50');
  }

  function resume(): void {
    waitingForInput = false;
  }

  return {
    event: async ({ event }) => {
      switch (event.type as string) {
        case 'session.status': {
          const { status } = event.properties as { status: { type: string } };
          switch (status.type) {
            case 'busy':
              if (!waitingForInput) progress('3');
              break;
            case 'idle':
              resume();
              progress('0');
              break;
          }
          break;
        }
        case 'session.idle':
          resume();
          progress('0');
          break;
        case 'session.error':
          resume();
          progress('2');
          break;
        case 'permission.asked':
          pause();
          break;
        case 'permission.replied':
          resume();
          progress('3');
          break;
      }
    },
    'permission.ask': async () => {
      pause();
    },
    'tool.execute.before': async (input) => {
      if (input.tool === 'question') {
        pause();
      }
    },
  };
};
