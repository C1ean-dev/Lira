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
 [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool repaint);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int z,uint flags);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 const string Key="LiraSpotifyOriginalStyle";
 // Chrome draws its app caption in the client area even after WS_CAPTION is removed.
 // Keep that area outside the host's clipping boundary, including after resizing.
 public static int[] ContentBounds(int w,int z,uint dpi) {
  // App caption (30 DIP) plus Chromium's top resize inset (8 DIP).
  int top=(int)Math.Round(38.0*(dpi==0 ? 96 : dpi)/96.0);
  return new int[] {0,-top,w,z+top};
 }
 static void Layout(IntPtr h,int w,int z) {
  int[] b=ContentBounds(w,z,GetDpiForWindow(h));
  MoveWindow(h,b[0],b[1],b[2],b[3],true);
 }
 static long Style(IntPtr h) { return IntPtr.Size==8 ? GetLong64(h,-16).ToInt64() : (long)(uint)GetLong32(h,-16); }
 static void Style(IntPtr h,long v) { if(IntPtr.Size==8) SetLong64(h,-16,new IntPtr(v)); else SetLong32(h,-16,unchecked((int)v)); }
 static bool Owned(IntPtr h,uint pid) { uint actual; return IsWindow(h) && GetWindowThreadProcessId(h,out actual)!=0 && actual==pid; }
 static void Parent(IntPtr h,IntPtr p) { SetLastError(0); SetParent(h,p); int e=Marshal.GetLastWin32Error(); if(e!=0) throw new System.ComponentModel.Win32Exception(e); }
 public static void Mount(IntPtr h,uint pid,IntPtr p,uint host,int w,int z) {
  if(!Owned(h,pid)||!Owned(p,host)) throw new Exception("Janela do Spotify inválida.");
  long original=Style(h);
  Rect rect;
  if(!GetWindowRect(h,out rect)) throw new Exception("Não foi possível ler a posição do Spotify.");
  SetProp(h,Key+"X",new IntPtr(rect.Left)); SetProp(h,Key+"Y",new IntPtr(rect.Top));
  SetProp(h,Key+"W",new IntPtr(rect.Right-rect.Left)); SetProp(h,Key+"H",new IntPtr(rect.Bottom-rect.Top));
  if(!SetProp(h,Key,new IntPtr(original))) throw new Exception("Não foi possível preparar a janela do Spotify.");
  try { Style(h,(original & ~0x80CF0000L)|0x50000000L); Parent(h,p); SetWindowPos(h,IntPtr.Zero,0,0,w,z,0x34); Layout(h,w,z); }
  catch { Style(h,original); RemoveProp(h,Key); throw; }
 }
 public static void Resize(IntPtr h,uint pid,int w,int z) { if(Owned(h,pid)) Layout(h,w,z); }
 public static void Release(IntPtr h,uint pid) {
  if(!Owned(h,pid)) return;
  IntPtr original=GetProp(h,Key);
  if(original==IntPtr.Zero) return;
  Parent(h,IntPtr.Zero); Style(h,original.ToInt64()); RemoveProp(h,Key);
  int x=RemoveProp(h,Key+"X").ToInt32(), y=RemoveProp(h,Key+"Y").ToInt32();
  int w=RemoveProp(h,Key+"W").ToInt32(), z=RemoveProp(h,Key+"H").ToInt32();
  SetWindowPos(h,IntPtr.Zero,x,y,Math.Max(1,w),Math.Max(1,z),0x34); ShowWindow(h,5);
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
  async mount(browser: SpotifyNativeWindow, parent: string, size: [number, number]) {
    await this.run(browser, `Mount(BROWSER, [IntPtr]::new([long]${numeric(parent)}), [uint32]${numeric(this.hostProcess)}, ${numeric(size[0])}, ${numeric(size[1])})`)
  }
  async resize(browser: SpotifyNativeWindow, size: [number, number]) {
    await this.run(browser, `Resize(BROWSER, ${numeric(size[0])}, ${numeric(size[1])})`)
  }
  async detach(browser: SpotifyNativeWindow) { await this.run(browser, 'Release(BROWSER)') }
}
