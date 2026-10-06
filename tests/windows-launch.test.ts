import { describe, expect, it } from 'vitest';
import { windowsAppId, windowsLaunchDetails } from '../src/main/windows-launch';

describe('Windows taskbar relaunch paths', () => {
  it('uses the persistent portable launcher after different temporary extractions', () => {
    const portable = 'D:\\Apps\\LLM Collaboration.exe';
    const first = windowsLaunchDetails('C:\\Users\\me\\AppData\\Local\\Temp\\first\\LLM Collaboration.exe', portable);
    const next = windowsLaunchDetails('C:\\Users\\me\\AppData\\Local\\Temp\\next\\LLM Collaboration.exe', portable);
    expect(first).toEqual(next);
    expect(first.target).toBe(portable);
    expect(first.appDetails).toMatchObject({ appId: windowsAppId, appIconPath: portable,
      relaunchCommand: '"D:\\Apps\\LLM Collaboration.exe"', relaunchDisplayName: 'LLM Collaboration' });
    expect(first.args).toEqual([]);
  });

  it('keeps an installed executable as its target', () => {
    const installed = 'C:\\Users\\me\\AppData\\Local\\Programs\\LLM Collaboration\\LLM Collaboration.exe';
    expect(windowsLaunchDetails(installed).target).toBe(installed);
  });

  it('keeps the project argument for an Electron development launch', () => {
    const details = windowsLaunchDetails('D:\\dev\\electron.exe', undefined, 'D:\\dev\\LLM Collaboration');
    expect(details.args).toEqual(['D:\\dev\\LLM Collaboration']);
    expect(details.appDetails.relaunchCommand).toBe('"D:\\dev\\electron.exe" "D:\\dev\\LLM Collaboration"');
  });

  it('ignores a relative portable path', () => {
    expect(windowsLaunchDetails('D:\\Apps\\LLM Collaboration.exe', 'relative.exe').target)
      .toBe('D:\\Apps\\LLM Collaboration.exe');
    expect(windowsLaunchDetails('D:\\dev\\electron.exe', 'relative.exe', 'D:\\dev\\project').args)
      .toEqual(['D:\\dev\\project']);
  });
});
