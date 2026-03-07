import type { Plugin } from '@opencode-ai/plugin';
import type { EventMessagePartUpdated, EventSessionStatus, ToolPart } from '@opencode-ai/sdk';

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

interface ToolTracker {
  known: Set<string>;
  done: Set<string>;
}

function toolProgress(messages: Map<string, ToolTracker>): number | undefined {
  let total = 0;
  let done = 0;
  for (const tracker of messages.values()) {
    total += tracker.known.size;
    done += tracker.done.size;
  }
  if (total === 0) return undefined;
  return Math.min(Math.round((done / total) * 100), 99);
}

export const TerminalProgressPlugin: Plugin = async () => {
  if (!detectTerminal()) return {};

  const osc = createOsc();

  let waitingForInput = false;
  let busy = false;
  const tools = new Map<string, ToolTracker>();

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

  function reset(): void {
    tools.clear();
  }

  function showBusy(): void {
    if (waitingForInput) return;

    const pct = toolProgress(tools);
    if (pct !== undefined) {
      progress(`1;${pct}`);
    } else {
      progress('3');
    }
  }

  return {
    event: async ({ event }) => {
      switch (event.type as string) {
        case 'session.status': {
          const { status } = (event as EventSessionStatus).properties;
          switch (status.type) {
            case 'busy':
              busy = true;
              showBusy();
              break;
            case 'idle':
              busy = false;
              resume();
              reset();
              progress('0');
              break;
          }
          break;
        }
        case 'session.idle':
          busy = false;
          resume();
          reset();
          progress('0');
          break;
        case 'session.error':
          busy = false;
          resume();
          reset();
          progress('2');
          break;
        case 'message.part.updated': {
          const { part } = (event as EventMessagePartUpdated).properties;

          if (part.type === 'tool') {
            const tp = part as ToolPart;
            const tracker = tools.get(tp.messageID) ?? {
              known: new Set<string>(),
              done: new Set<string>(),
            };

            tracker.known.add(tp.callID);
            if (tp.state.status === 'completed' || tp.state.status === 'error') {
              tracker.done.add(tp.callID);
            }

            if (tracker.done.size === tracker.known.size) {
              tools.delete(tp.messageID);
            } else {
              tools.set(tp.messageID, tracker);
            }

            if (busy) showBusy();
          }
          break;
        }
        case 'permission.asked':
          pause();
          break;
        case 'permission.replied':
          resume();
          showBusy();
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
