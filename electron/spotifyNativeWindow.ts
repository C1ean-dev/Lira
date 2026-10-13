import type { SpotifyNativeWindow } from './spotifyWindowHost'

// Separate invocations retain the original style on the HWND, not in a shell process.
const native = `
using System;
using System.Runtime.InteropServices;
public static class LiraSpotifyHost {
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr h, IntPtr p);
 [DllImport("kernel32.dll")] static extern void SetLastError(uint e);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong64(IntPtr h,int n);
 [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetLong64(IntPtr h,int n,IntPtr v);
 [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetLong32(IntPtr h,int n);
 [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetLong32(IntPtr h,int n,int v);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr h,string k,IntPtr v);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h,string k);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h,string k);
 [DllImport("user32.dll", SetLastError=true)] static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool repaint);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int z,uint flags);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr p,IntPtr h);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetFocus(IntPtr h);
 [DllImport("user32.dll", SetLastError=true)] static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo {
  public uint Size, Flags;
  public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
  public Rect CaretRect;
 }
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
 const string Key="LiraSpotifyOriginalStyle";
 // Chrome draws its app caption in the client area even after WS_CAPTION is removed.
 // Keep that area outside the host's clipping boundary, including after resizing.
 public static int[] ContentBounds(int w,int z,uint dpi) {
  // App caption (30 DIP) plus Chromium's top resize inset (8 DIP).
  int top=(int)Math.Round(38.0*(dpi==0 ? 96 : dpi)/96.0);
  return new int[] {0,-top,w,z+top};
 }
 static IntPtr EnterDpi(IntPtr h) {
  IntPtr previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(h));
  if(previous==IntPtr.Zero) throw new Exception("Não foi possível ajustar a escala do Spotify.");
  return previous;
 }
 static void Layout(IntPtr h,IntPtr p) {
  // Read and apply sizes in the host's DPI context. PowerShell defaults to DPI
  // unaware; MoveWindow would otherwise scale these coordinates a second time.
  Rect client;
  if(!GetClientRect(p,out client)) throw new Exception("Não foi possível ler o tamanho da janela do Spotify.");
  int w=client.Right-client.Left,z=client.Bottom-client.Top;
  if(w<=0||z<=0) return; // A minimized host has no usable client area.
  int[] b=ContentBounds(w,z,GetDpiForWindow(p));
  if(!MoveWindow(h,b[0],b[1],b[2],b[3],true)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
 }
 static long Style(IntPtr h) { return IntPtr.Size==8 ? GetLong64(h,-16).ToInt64() : (long)(uint)GetLong32(h,-16); }
 static void Style(IntPtr h,long v) { if(IntPtr.Size==8) SetLong64(h,-16,new IntPtr(v)); else SetLong32(h,-16,unchecked((int)v)); }
 static bool Owned(IntPtr h,uint pid) { uint actual; return IsWindow(h) && GetWindowThreadProcessId(h,out actual)!=0 && actual==pid; }
 static void Parent(IntPtr h,IntPtr p) { SetLastError(0); SetParent(h,p); int e=Marshal.GetLastWin32Error(); if(e!=0) throw new System.ComponentModel.Win32Exception(e); }
 public static void Mount(IntPtr h,uint pid,IntPtr p,uint host) {
  if(!Owned(h,pid)||!Owned(p,host)) throw new Exception("Janela do Spotify inválida.");
  IntPtr previous=EnterDpi(p);
  try {
  long original=Style(h);
  Rect rect;
  if(!GetWindowRect(h,out rect)) throw new Exception("Não foi possível ler a posição do Spotify.");
  SetProp(h,Key+"X",new IntPtr(rect.Left)); SetProp(h,Key+"Y",new IntPtr(rect.Top));
  SetProp(h,Key+"W",new IntPtr(rect.Right-rect.Left)); SetProp(h,Key+"H",new IntPtr(rect.Bottom-rect.Top));
  if(!SetProp(h,Key,new IntPtr(original))) throw new Exception("Não foi possível preparar a janela do Spotify.");
  try { Style(h,(original & ~0x80CF0000L)|0x50000000L); Parent(h,p); SetWindowPos(h,IntPtr.Zero,0,0,0,0,0x37); Layout(h,p); }
  catch { Style(h,original); RemoveProp(h,Key); throw; }
  } finally { SetThreadDpiAwarenessContext(previous); }
 }
 public static void Resize(IntPtr h,uint pid,IntPtr p,uint host) {
  if(!Owned(h,pid)||!Owned(p,host)||GetParent(h)!=p) return;
  IntPtr previous=EnterDpi(p);
  try { Layout(h,p); } finally { SetThreadDpiAwarenessContext(previous); }
 }
 public static void Focus(IntPtr h,uint pid,IntPtr p,uint host) {
  // Do not steal focus from another app or an OAuth/passkey popup.
  if(!Owned(h,pid)||!Owned(p,host)||GetParent(h)!=p||GetForegroundWindow()!=p) return;
  uint owner;
  uint browserThread=GetWindowThreadProcessId(h,out owner);
  GuiInfo info=new GuiInfo(); info.Size=(uint)Marshal.SizeOf(typeof(GuiInfo));
  // Preserve the focused input or Chromium render widget when it already owns focus.
  if(GetGUIThreadInfo(browserThread,ref info) && (info.Focus==h || IsChild(h,info.Focus))) return;
  uint current=GetCurrentThreadId();
  bool attached=current!=browserThread;
  if(attached && !AttachThreadInput(current,browserThread,true)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  try { SetLastError(0); SetFocus(h); int error=Marshal.GetLastWin32Error(); if(error!=0) throw new System.ComponentModel.Win32Exception(error); }
  finally { if(attached) AttachThreadInput(current,browserThread,false); }
 }
 public static void Release(IntPtr h,uint pid) {
  if(!Owned(h,pid)) return;
  IntPtr original=GetProp(h,Key);
  if(original==IntPtr.Zero) return;
  IntPtr previous=EnterDpi(h);
  try {
  Parent(h,IntPtr.Zero); Style(h,original.ToInt64()); RemoveProp(h,Key);
  int x=RemoveProp(h,Key+"X").ToInt32(), y=RemoveProp(h,Key+"Y").ToInt32();
  int w=RemoveProp(h,Key+"W").ToInt32(), z=RemoveProp(h,Key+"H").ToInt32();
  SetWindowPos(h,IntPtr.Zero,x,y,Math.Max(1,w),Math.Max(1,z),0x34); ShowWindow(h,5);
  } finally { SetThreadDpiAwarenessContext(previous); }
 }
}`

function numeric(value: string | number): string {
  const text = String(value)
  if (!/^[1-9][0-9]*$/.test(text) || BigInt(text) > 0x7fffffffffffffffn) throw new Error('Identificador de janela inválido.')
  return text
}

export class SpotifyNativeWindowBridge {
  constructor(private query: (script: string) => Promise<string>, private hostProcess: number) {}
  private async run(browser: SpotifyNativeWindow, operation: string) {
    const handle = numeric(browser.handle)
    const pid = numeric(browser.processId)
    await this.query(`$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${native}\n'@\n[LiraSpotifyHost]::${operation.replace('BROWSER', `[IntPtr]::new([long]${handle}), [uint32]${pid}`)} | Out-Null`)
  }
  async mount(browser: SpotifyNativeWindow, parent: string) {
    await this.run(browser, `Mount(BROWSER, [IntPtr]::new([long]${numeric(parent)}), [uint32]${numeric(this.hostProcess)})`)
  }
  async resize(browser: SpotifyNativeWindow, parent: string) {
    await this.run(browser, `Resize(BROWSER, [IntPtr]::new([long]${numeric(parent)}), [uint32]${numeric(this.hostProcess)})`)
  }
  async detach(browser: SpotifyNativeWindow) { await this.run(browser, 'Release(BROWSER)') }
  async focus(browser: SpotifyNativeWindow, parent: string) {
    await this.run(browser, `Focus(BROWSER, [IntPtr]::new([long]${numeric(parent)}), [uint32]${numeric(this.hostProcess)})`)
  }
}
