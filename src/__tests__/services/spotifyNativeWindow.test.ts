import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { SpotifyNativeWindowBridge } from '../../../electron/spotifyNativeWindow'

describe('dedicated Spotify native window bridge', () => {
  it.skipIf(process.platform !== 'win32')('fits the physical host client area when the shell uses a different DPI context', async () => {
    let output = ''
    const bridge = new SpotifyNativeWindowBridge(async script => {
      const declarations = script.slice(0, script.lastIndexOf('[LiraSpotifyHost]::'))
      output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', declarations.replace(/'@\s*$/, '') + `
public static class GeometryFixture {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(int ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool repaint);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int L,T,R,B;}
 public static int[] Run(uint pid) {
  var original=SetThreadDpiAwarenessContext(new IntPtr(-4));
  var parent=CreateWindowEx(0,"STATIC","fixture host",0x80000000,0,0,1250,929,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
  var child=CreateWindowEx(0,"STATIC","fixture browser",0x80000000,0,0,600,450,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
  if(parent==IntPtr.Zero||child==IntPtr.Zero) throw new Exception("Fixture window creation failed");
  try {
   SetThreadDpiAwarenessContext(new IntPtr(-1));
   LiraSpotifyHost.Mount(child,pid,parent,pid);
   SetThreadDpiAwarenessContext(new IntPtr(-4));
   Rect mounted;GetWindowRect(child,out mounted);int top=(int)Math.Round(38.0*GetDpiForWindow(child)/96.0);
   MoveWindow(parent,0,0,790,520,false);
   SetThreadDpiAwarenessContext(new IntPtr(-1));
   LiraSpotifyHost.Resize(child,pid,parent,pid);
   SetThreadDpiAwarenessContext(new IntPtr(-4));
   Rect resized;GetWindowRect(child,out resized);
   return new[]{mounted.R-mounted.L,mounted.B-mounted.T-top,resized.R-resized.L,resized.B-resized.T-top};
  } finally { DestroyWindow(child);DestroyWindow(parent);SetThreadDpiAwarenessContext(original); }
 }
}
'@
[GeometryFixture]::Run([uint32]$PID) | ConvertTo-Json -Compress
`], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
      return ''
    }, process.pid)
    await bridge.mount({ processId: 70, handle: '42', title: '' }, '99')
    expect(JSON.parse(output)).toEqual([1250, 929, 790, 520])
  }, 15000)
  it.skipIf(process.platform !== 'win32')('clips only the browser caption at normal and scaled DPI without shrinking the page', async () => {
    for (const [dpi, top] of [[96, 38], [144, 57], [192, 76]]) {
      let output = ''
      const bridge = new SpotifyNativeWindowBridge(async script => {
        const declarations = script.slice(0, script.lastIndexOf('[LiraSpotifyHost]::'))
        output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', declarations + `[LiraSpotifyHost]::ContentBounds(900,700,${dpi}) | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
        return ''
      }, process.pid)
      await bridge.resize({ processId: 70, handle: '42', title: '' }, '99')
      expect(JSON.parse(output)).toEqual([0, -top, 900, 700 + top])
    }
  }, 30000)
  it.skipIf(process.platform !== 'win32')('compiles the native bridge and rejects an absent window without changing any window', async () => {
    const bridge = new SpotifyNativeWindowBridge(async script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' }), process.pid)
    await expect(bridge.mount({ processId: 2147483647, handle: '1', title: '' }, '1')).rejects.toThrow(/Janela do Spotify/)
  }, 30000)
  it('guards handles before executing native commands', async () => {
    const query = vi.fn(async () => '')
    const bridge = new SpotifyNativeWindowBridge(query, 123)
    await expect(bridge.mount({ processId: 70, handle: '42;exit', title: '' }, '99')).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
  it('rejects an invalid focus target before executing native commands', async () => {
    const query = vi.fn(async () => '')
    const bridge = new SpotifyNativeWindowBridge(query, 123)
    await expect(bridge.focus({ processId: 70, handle: '42', title: '' }, '99;exit')).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
  it.skipIf(process.platform !== 'win32')('ignores a stale browser focus request without stealing foreground focus', async () => {
    const bridge = new SpotifyNativeWindowBridge(async script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script + `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FocusCheck { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$before = [FocusCheck]::GetForegroundWindow()
[LiraSpotifyHost]::Focus([IntPtr]::new(1), 2147483647, [IntPtr]::new(1), 2147483647)
if ([FocusCheck]::GetForegroundWindow() -ne $before) { throw 'Foreground focus changed' }
`], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' }), process.pid)
    await expect(bridge.focus({ processId: 2147483647, handle: '1', title: '' }, '1')).resolves.toBeUndefined()
  }, 15000)
  it('checks ownership, preserves the original frame and releases the browser on detach', async () => {
    const query = vi.fn(async () => '')
    const bridge = new SpotifyNativeWindowBridge(query, 123)
    const browser = { processId: 70, handle: '42', title: 'Spotify' }
    await bridge.mount(browser, '99')
    expect(query.mock.calls[0][0]).toContain('GetWindowThreadProcessId')
    expect(query.mock.calls[0][0]).toContain('SetProp')
    await bridge.detach(browser)
    expect(query.mock.calls[1][0]).toContain('Release')
  })
})
