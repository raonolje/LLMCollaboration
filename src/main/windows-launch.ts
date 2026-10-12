import path from 'node:path';

export const windowsAppId = 'me.raonolje.llmcollaboration';

// A portable build runs an extracted executable in TEMP. Windows must relaunch
// the original launcher so taskbar pins and protocol links survive its cleanup.
export const windowsLaunchDetails = (executable: string, portableExecutable?: string, developmentEntry?: string) => {
  const portable = portableExecutable && path.win32.isAbsolute(portableExecutable) ? portableExecutable : undefined;
  const target = portable ?? executable;
  const args = developmentEntry && !portable ? [path.win32.resolve(developmentEntry)] : [];
  return {
    target,
    args,
    appDetails: {
      appId: windowsAppId,
      appIconPath: target,
      appIconIndex: 0,
      relaunchCommand: [target, ...args].map((value) => `"${value}"`).join(' '),
      relaunchDisplayName: 'LLM Collaboration',
    },
  };
};
