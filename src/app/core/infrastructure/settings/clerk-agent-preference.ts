/**
 * Where the operator's answer to "should she hold a conversation?" is remembered.
 *
 * Its own key rather than a field on a settings blob, following the mute
 * precedent in `speech-synthesis.service.ts`: one switch, one key, readable in a
 * devtools storage pane by whoever is asked why the till stopped answering.
 */
export const AGENT_PREF_KEY = 'capy-clerk-agent';

/**
 * Whether this till is allowed to answer open-ended phrases.
 *
 * **Absent means conversational**, mirroring "silence is opt-in, so absent means
 * audible" on the mute key. The build flag `features.clerkAgent` — not this
 * switch — decides whether money *can* be spent on a model at all; this switch is
 * for a shop on an agent-capable build that wants commands only, and a shop that
 * has never expressed an opinion has not asked for that.
 *
 * Remembered at all for the same reason mute is: this is the one clerk setting
 * whose "on" position spends money, and a setting that resets on every refresh is
 * a setting a shop cannot rely on.
 */
export function readAgentPreference(): boolean {
  try {
    return localStorage.getItem(AGENT_PREF_KEY) !== 'commands';
  } catch {
    // Private mode or blocked storage: default to conversational, which is the
    // state the HUD shows and the one a new till is expected to be in.
    return true;
  }
}

export function writeAgentPreference(on: boolean): void {
  try {
    localStorage.setItem(AGENT_PREF_KEY, on ? 'conversational' : 'commands');
  } catch {
    // Not remembering it is survivable; pressing the switch again is one key.
  }
}
