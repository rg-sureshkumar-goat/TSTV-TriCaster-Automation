// @ts-check
// Turns the raw results into answers to the brief's "Verify on the TC1 first" questions,
// plus a short summary RG can read in the terminal.

/**
 * @typedef {{ id: string, question: string, answer: 'Yes' | 'No' | 'Partly' | 'Not sure', detail: string[] }} Answer
 */

/**
 * @param {any} results the object runProbe builds
 * @returns {Answer[]}
 */
export function buildAnswers(results) {
  const chosen = results.discovery?.chosen;
  const host = chosen?.host;
  const ports = results.ports ?? {};
  const http = results.http?.requests ?? {};
  const version = http['/v1/version'];
  const states = results.stateStream?.states ?? {};
  // The TC1 also reports what every control-panel model would show; those mirrors aren't useful here.
  const stateNames = Object.keys(states).filter((n) => !PANEL_MIRROR.test(n));
  const steps = results.guidedSteps ?? [];
  // Everything that moved during a step, including things switched on and back off again.
  const stepChanges = (/** @type {string} */ id) => {
    const step = steps.find((/** @type {any} */ s) => s.id === id && !s.skipped);
    if (!step) return [];
    const names = [...(step.sequence ?? []).map((/** @type {any} */ c) => c.name), ...Object.keys(step.changedStates ?? {})];
    return [...new Set(names)].filter((n) => !PANEL_MIRROR.test(n));
  };
  const okKeys = Object.entries(results.http?.dictionary ?? {})
    .filter(([, r]) => /** @type {any} */ (r).status === 200 && /** @type {any} */ (r).bytes > 0)
    .map(([key]) => key);
  const matching = (/** @type {RegExp} */ re) => stateNames.filter((n) => re.test(n));
  const list = (/** @type {string[]} */ names, max = 12) =>
    names.length === 0 ? 'none' : names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '');

  /** @type {Answer[]} */
  const answers = [];

  // 1. Reaching the TC1
  {
    /** @type {string[]} */
    const detail = [];
    /** @type {Answer['answer']} */
    let answer;
    const reachable = chosen && Object.values(chosen.quickPorts ?? {}).some((s) => s === 'open');
    if (reachable) {
      answer = 'Yes';
      detail.push(`The TC1 answered at ${host}${chosen.adapter ? ` through adapter ${chosen.adapter}` : ''} (found by: ${chosen.sources.join(', ')}).`);
      if (chosen.names?.length) detail.push(`It calls itself: ${list(chosen.names, 6)}.`);
      if (String(host).startsWith('169.254.')) detail.push('Both sides used automatic addresses, so no network settings had to change.');
      if (String(host).includes(':')) detail.push('It was reached over IPv6 only. The show app can do the same, so no settings change is needed.');
    } else if ((results.laptop?.wiredAdapters ?? []).length === 0 && !results.options?.host) {
      answer = 'No';
      detail.push('This laptop did not see a cable connection. Check that the adapter is plugged in, the cable goes to the TC1 port, and its light is on.');
    } else if ((results.discovery?.offSubnet ?? []).length > 0) {
      answer = 'No';
      const ips = results.discovery.offSubnet.map((/** @type {any} */ o) => o.ip).join(', ');
      detail.push(`A device on the cable uses a fixed address (${ips}) that doesn't match the laptop's automatic address.`);
      detail.push('Fallback from the brief: ask for approval to set the TC1 port to "obtain an address automatically".');
    } else {
      answer = 'No';
      detail.push('Nothing answered on the cable. The TC1 may block connections in Windows Firewall, or the cable may be in a different port.');
    }
    answers.push({ id: 'reach', question: 'Can a laptop on the cable reach the TC1, and at what address?', answer, detail });
  }

  const reached = Boolean(chosen && Object.values(chosen.quickPorts ?? {}).some((s) => s === 'open'));
  if (!reached) {
    const notChecked = ['Not checked, because the probe could not reach the TC1.'];
    for (const [id, question] of [
      ['interface', 'Which remote-control interface does the TC1 accept, and what commands does it list?'],
      ['ddr2', 'Can DDR2 jump to a specific playlist item, play, stop, and report when a clip ends?'],
      ['files', 'Can files be copied onto the TC1 and loaded into DDR2 and GFX 1 remotely?'],
      ['record', 'Can recording start and stop remotely, and can its save location be set?'],
      ['state', "Can the app read what's on program, DSK 2 and the M/Es?"],
    ]) {
      answers.push({ id, question, answer: 'Not sure', detail: notChecked });
    }
    return answers;
  }

  // 2. Remote-control interface
  {
    /** @type {string[]} */
    const detail = [];
    const httpOk = version?.status === 200;
    const stateOk = results.stateStream?.connected && stateNames.length > 0;
    const wsOk = results.notifications?.upgraded;
    if (version) {
      if (httpOk) detail.push(`Web API (port ${results.options.httpPort}, /v1): answers. ${describeProduct(version.body)}`);
      else if (version.status === 401) detail.push(`Web API (port ${results.options.httpPort}): asks for the LivePanel password${results.http?.authUsed ? '; the password you typed worked' : ''}.`);
      else detail.push(`Web API (port ${results.options.httpPort}): ${version.error ?? `HTTP ${version.status}`}.`);
    }
    detail.push(
      stateOk
        ? `State stream (port ${results.options.statePort}): connected and listed ${stateNames.length} state names.`
        : `State stream (port ${results.options.statePort}): ${results.stateStream?.error ?? (results.stateStream?.connected ? 'connected but sent no states' : 'not reached')}.`,
    );
    detail.push(
      wsOk
        ? `Change notifications: connected, ${results.notifications.messages.length} message(s) received.`
        : `Change notifications: ${results.notifications?.error ?? `not available (HTTP ${results.notifications?.status ?? '?'})`}.`,
    );
    if (okKeys.length) detail.push(`Readable data: ${list(okKeys, 20)}.`);
    const macros = (results.http?.dictionary?.macros_list?.body ?? '').match(/<macro\b/g)?.length ?? 0;
    if (macros) detail.push(`Macros on the TC1: ${macros}.`);
    detail.push('The TriCaster doesn\'t publish a list of commands, so command names are confirmed in live mode during Phase 5.');
    answers.push({
      id: 'interface',
      question: 'Which remote-control interface does the TC1 accept, and what commands does it list?',
      answer: httpOk || stateOk ? 'Yes' : version?.status === 401 ? 'Partly' : 'No',
      detail,
    });
  }

  // 3. DDR2
  {
    const ddr2 = matching(/^ddr2_(play|stop|select_clips|autoplay_mode_toggle|single_mode_toggle)$/i);
    const changedWhilePlaying = [...new Set([...stepChanges('ddr2_play'), ...stepChanges('ddr2_end')])].filter((n) => /^ddr2_(play|stop)$/i.test(n));
    const changedOnSelect = stepChanges('ddr2_select').filter((n) => /^ddr2_/i.test(n));
    /** @type {string[]} */
    const detail = [`Key DDR2 states: ${list(ddr2)}.`];
    if (okKeys.includes('ddr_playlist')) detail.push('The playlist itself is readable (ddr_playlist): every clip, its file and its length.');
    if (okKeys.includes('ddr_timecode')) detail.push('Clip timing is readable (ddr_timecode): seconds elapsed and remaining in the current clip.');
    if (changedOnSelect.length) detail.push(`Picking a playlist item changed: ${list(changedOnSelect)}.`);
    if (changedWhilePlaying.length) detail.push(`Playing and stopping changed: ${list(changedWhilePlaying)}. That means the app can see when a clip stops.`);
    detail.push('Jumping to an item and playing it are commands, so they get confirmed in live mode (Phase 5).');
    answers.push({
      id: 'ddr2',
      question: 'Can DDR2 jump to a specific playlist item, play, stop, and report when a clip ends?',
      answer: changedWhilePlaying.length ? 'Partly' : 'Not sure',
      detail,
    });
  }

  // 4. Files
  {
    const smb = ports['445'];
    const share = results.fileSharing;
    /** @type {string[]} */
    const detail = [`Windows file sharing (port 445): ${smb ?? 'not checked'}.`];
    if (share?.shareList) {
      const out = `${share.shareList.stdout}\n${share.shareList.stderr}`.trim();
      if (/auth|access is denied|denied|logon/i.test(out)) detail.push('Listing the shared folders needs a Windows login on the TC1 (the TC1 owner would have to approve one).');
      else detail.push(`Share list: ${out ? out.split(/\r?\n/).slice(0, 8).join(' | ') : '(no output)'}`);
    }
    detail.push('Loading files into DDR2 and GFX 1 remotely is a command, so it gets confirmed in live mode (Phase 5).');
    answers.push({
      id: 'files',
      question: 'Can files be copied onto the TC1 and loaded into DDR2 and GFX 1 remotely?',
      answer: smb === 'open' ? 'Not sure' : 'No',
      detail,
    });
  }

  // 5. Recording
  {
    const record = matching(/^record_/i);
    const changed = stepChanges('record').filter((n) => /^record_/i.test(n));
    /** @type {string[]} */
    const detail = [`Recording states reported: ${list(record)}.`];
    if (changed.length) detail.push(`Starting and stopping recording changed: ${list(changed)}, so the app can see when the TC1 is recording.`);
    if (results.http?.notificationReads?.record_configuration) detail.push('Recording settings are readable (record_configuration).');
    detail.push('Starting recording and setting where it saves are commands, so they get confirmed in live mode (Phase 5).');
    answers.push({
      id: 'record',
      question: 'Can recording start and stop remotely, and can its save location be set?',
      answer: record.length ? 'Partly' : 'Not sure',
      detail,
    });
  }

  // 6. Reading what's on air
  {
    const dsk2 = matching(/^main_dsk2_(select_named_input|value|take)$/i);
    const me2 = matching(/^v2_(a|b)_row_named_input$/i);
    const program = states.main_a_row_named_input?.value;
    const programTally = states.program_tally?.value;
    const tally = okKeys.includes('tally');
    const switcher = okKeys.includes('switcher');
    /** @type {string[]} */
    const detail = [
      `Tally (what's on program and preview): ${tally ? 'readable' : 'not readable'}.`,
      `Switcher summary: ${switcher ? 'readable' : 'not readable'}.`,
      `DSK 2 states: ${list(dsk2, 8)}.`,
      `M/E 2 states: ${list(me2, 8)}.`,
    ];
    if (program) detail.push(`Program row shows: ${program}${programTally ? `; what's on air: ${programTally}` : ''}.`);
    const cam = stepChanges('camera').filter((n) => /_row_named_input$|^program_tally$/.test(n));
    if (cam.length) detail.push(`Taking a camera changed: ${list(cam, 8)}.`);
    const dskStep = stepChanges('dsk2').filter((n) => /^(main_dsk2_(value|take)|ddr2_(play|stop|select_clips))$/.test(n));
    if (dskStep.length) detail.push(`DSK 2 on/off changed: ${list(dskStep, 8)}.`);
    answers.push({
      id: 'state',
      question: "Can the app read what's on program, DSK 2 and the M/Es?",
      answer: tally && dsk2.length ? 'Yes' : tally || stateNames.length ? 'Partly' : 'No',
      detail,
    });
  }

  return answers;
}

const PANEL_MIRROR = /^(minics_|strip\d+_|cs\d+_|tcs_|tc1l_|gemini|keyboard_bank|swit45_)/;

/** @param {string} body */
function describeProduct(body) {
  const field = (/** @type {string} */ name) => body.match(new RegExp(`<${name}>([^<]*)</${name}>|${name}="([^"]*)"`))?.slice(1).find(Boolean);
  const parts = [field('product_name'), field('product_version'), field('machine_name') && `machine ${field('machine_name')}`, field('session_name') && `session ${field('session_name')}`];
  const text = parts.filter(Boolean).join(', ');
  return text ? `It reports: ${text}.` : '';
}

/**
 * @param {any} results
 * @param {{ json: string, summary: string }} files
 */
export function buildSummary(results, files) {
  const lines = [];
  lines.push('TSTV TriCaster probe: summary');
  lines.push('='.repeat(32));
  lines.push(`Run: ${new Date(results.probe.startedAt).toLocaleString()}${results.probe.stoppedEarly ? ' (stopped early)' : ''}`);
  lines.push(`Laptop: ${results.laptop.platform} ${results.laptop.release}, Node ${results.laptop.node}`);
  lines.push(`Cable adapter(s): ${(results.laptop.wiredAdapters ?? []).join(', ') || 'none found'}`);
  lines.push('The probe only read from the TC1. It sent no commands.');
  lines.push('');
  for (const answer of results.answers) {
    lines.push(`${answer.answer.toUpperCase().padEnd(8)} ${answer.question}`);
    for (const line of answer.detail) lines.push(`         - ${line}`);
    lines.push('');
  }
  if (results.errors?.length) {
    lines.push('Problems during the run:');
    for (const e of results.errors) lines.push(`  - ${e}`);
    lines.push('');
  }
  lines.push('Files saved:');
  lines.push(`  ${files.json}`);
  lines.push(`  ${files.summary}`);
  lines.push('');
  lines.push('Next: send the .json file to Claude Code (or leave it in tools/probe/results/ on this laptop).');
  return lines.join('\n');
}
