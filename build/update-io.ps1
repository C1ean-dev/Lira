# One streaming read both copies and hashes a file. Counters also feed installation progress.
# Reuse the helper when a host already loaded the assembly.
if ('LiraUpdateIO' -as [type]) { return }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

public sealed class LiraUpdateFile {
  public string Name { get; set; }
  public long Length { get; set; }
  public string Hash { get; set; }
}

public sealed class LiraUpdateTree {
  public bool Existed { get; set; }
  public LiraUpdateFile[] Files { get; set; }
  public string[] Directories { get; set; }
}

public static class LiraUpdateIO {
  public static LiraUpdateTree SnapshotTree(string source) {
    source = Path.GetFullPath(source).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(source, null);
    if (File.Exists(source)) throw new IOException("Invalid source directory: " + source);
    var files = new List<LiraUpdateFile>();
    var directories = new List<string>();
    bool existed = Directory.Exists(source);
    if (existed) {
      var pending = new Stack<DirectoryInfo>();
      pending.Push(new DirectoryInfo(source));
      while (pending.Count > 0) {
        foreach (FileSystemInfo item in pending.Pop().EnumerateFileSystemInfos()) {
          if ((item.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Linked path: " + item.FullName);
          string relative = item.FullName.Substring(source.Length + 1);
          var directory = item as DirectoryInfo;
          if (directory != null) {
            directories.Add(relative);
            pending.Push(directory);
          } else {
            files.Add(new LiraUpdateFile { Name = relative, Length = ((FileInfo)item).Length });
          }
        }
      }
    }
    return new LiraUpdateTree { Existed = existed, Files = files.ToArray(), Directories = directories.ToArray() };
  }
  public static long SourceReadBytes, VerificationReadBytes, FilesCopied;
  private static readonly Stopwatch progressClock = Stopwatch.StartNew();
  private static long lastProgress = -250;
  // Reuse the streaming buffer: thousands of small assets must not allocate megabytes per file.
  [ThreadStatic] private static byte[] streamingBuffer;
  private static byte[] GetBuffer() {
    return streamingBuffer ?? (streamingBuffer = new byte[1024 * 1024]);
  }
  private static int ReadParallelism() {
    return Math.Min(4, Math.Max(2, Environment.ProcessorCount));
  }
  private static bool IsTransientPublishError(Exception error) {
    if (error is UnauthorizedAccessException) return true;
    var io = error as IOException;
    if (io == null) return false;
    int code = io.HResult & 0xFFFF;
    return code == 2 || code == 5 || code == 32 || code == 33 || code == 183 || code == 1175 || code == 1176 || code == 1177;
  }
  public static void PublishFile(string temporary, string destination) {
    int[] delaysMs = { 20, 40, 80, 150, 250, 400 };
    for (int attempt = 0; ; attempt++) {
      try {
        if (File.Exists(destination)) File.Replace(temporary, destination, null);
        else File.Move(temporary, destination);
        return;
      } catch (Exception error) {
        if (attempt >= delaysMs.Length || !File.Exists(temporary) || !IsTransientPublishError(error)) throw;
        Thread.Sleep(delaysMs[attempt]);
      }
    }
  }
  public static void WriteDurableText(string file, string text) {
    byte[] bytes = new System.Text.UTF8Encoding(false).GetBytes(text);
    using (var output = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None)) {
      output.Write(bytes, 0, bytes.Length);
      output.Flush(true);
    }
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter,
    string text, uint flags, uint timeout, out UIntPtr result);

  public static void SetProgress(long window, string text) {
    if (window == 0) return;
    UIntPtr result;
    SendMessageTimeout(new IntPtr(window), 12, UIntPtr.Zero, text, 2, 100, out result);
  }

  private static void NotifyProgress(Action progress) {
    if (progress == null) return;
    long now = progressClock.ElapsedMilliseconds;
    long prev = Interlocked.Read(ref lastProgress);
    if (now - prev < 250) return;
    if (Interlocked.CompareExchange(ref lastProgress, now, prev) == prev) {
      progress();
    }
  }

  private static string ChildPath(string root, string name) {
    if (String.IsNullOrEmpty(name) || Path.IsPathRooted(name) || name.IndexOf(':') >= 0)
      throw new IOException("Invalid backup entry.");
    string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    string target = Path.GetFullPath(Path.Combine(prefix, name));
    if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Invalid backup entry.");
    return target;
  }

  private static void RequireRegularPath(string target, string stopAt) {
    // Check only the entry and its ancestors, never enumerate descendants or follow a junction.
    while (target != null && !String.Equals(target, stopAt, StringComparison.OrdinalIgnoreCase)) {
      try {
        if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
          throw new IOException("Linked path: " + target);
      } catch (FileNotFoundException) {
      } catch (DirectoryNotFoundException) {
      }
      target = Path.GetDirectoryName(target);
    }
  }

  private static void RequireRegularPathCached(string target, string stopAt, ConcurrentDictionary<string, byte> verifiedDirs) {
    string current = target;
    bool isLeaf = true;
    while (current != null && !String.Equals(current, stopAt, StringComparison.OrdinalIgnoreCase)) {
      if (!isLeaf && verifiedDirs.ContainsKey(current)) break;
      try {
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
          throw new IOException("Linked path: " + current);
      } catch (FileNotFoundException) {
      } catch (DirectoryNotFoundException) {
      }
      if (!isLeaf) verifiedDirs.TryAdd(current, 0);
      current = Path.GetDirectoryName(current);
      isLeaf = false;
    }
  }

  public static void AssertRegularPath(string target) {
    if (String.IsNullOrEmpty(target)) return;
    RequireRegularPath(Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar), null);
  }

  public static void AssertRegularTree(string root) {
    if (String.IsNullOrEmpty(root)) return;
    string full = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(full, null);
    if (!Directory.Exists(full)) return;
    var pending = new Stack<DirectoryInfo>();
    pending.Push(new DirectoryInfo(full));
    while (pending.Count > 0) {
      foreach (FileSystemInfo item in pending.Pop().EnumerateFileSystemInfos()) {
        if ((item.Attributes & FileAttributes.ReparsePoint) != 0)
          throw new IOException("Linked path: " + item.FullName);
        var dir = item as DirectoryInfo;
        if (dir != null) pending.Push(dir);
      }
    }
  }

  private static void RunParallelWithProgress(Action work, Action progress) {
    Task running = Task.Run(work);
    try {
      NotifyProgress(progress);
      while (!running.Wait(250)) NotifyProgress(progress);
    } finally {
      running.GetAwaiter().GetResult();
    }
  }

  public static void CopyTree(string source, string destination, LiraUpdateFile[] files, string[] directories, Action progress) {
    source = Path.GetFullPath(source).TrimEnd(Path.DirectorySeparatorChar);
    destination = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(source, null);
    RequireRegularPath(destination, null);
    if (!Directory.Exists(source)) throw new DirectoryNotFoundException(source);
    Directory.CreateDirectory(destination);
    foreach (string name in directories ?? new string[0]) {
      string input = ChildPath(source, name);
      string output = ChildPath(destination, name);
      RequireRegularPath(input, source);
      RequireRegularPath(output, destination);
      if (!Directory.Exists(input)) throw new DirectoryNotFoundException(input);
      Directory.CreateDirectory(output);
    }
    var verifiedSrc = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    var verifiedDst = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    // Bound IO concurrency and keep all PowerShell/UI callbacks on the caller's thread.
    // Even a busy installer progress window must not pause file writes.
    RunParallelWithProgress(delegate {
      Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = 2 }, delegate(LiraUpdateFile file) {
        string input = ChildPath(source, file.Name);
        string output = ChildPath(destination, file.Name);
        RequireRegularPathCached(input, source, verifiedSrc);
        RequireRegularPathCached(output, destination, verifiedDst);
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        string hash = CopyAndHash(input, output, file.Length, null);
        if (!String.IsNullOrEmpty(file.Hash) && !String.Equals(file.Hash, hash, StringComparison.OrdinalIgnoreCase))
          throw new IOException("Backup changed while copying: " + file.Name);
        file.Hash = hash;
      });
    }, progress);
  }

  public static void VerifyTree(string directory, LiraUpdateFile[] files, bool moved, Action progress) {
    directory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(directory, null);
    if (!Directory.Exists(directory)) throw new DirectoryNotFoundException(directory);
    if (files == null || files.Length == 0) return;
    var verifiedDirs = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    RunParallelWithProgress(delegate {
      Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = ReadParallelism() }, delegate(LiraUpdateFile file) {
        string target = ChildPath(directory, file.Name);
        RequireRegularPathCached(target, directory, verifiedDirs);
        if (new FileInfo(target).Length != file.Length || (!moved &&
            (String.IsNullOrEmpty(file.Hash) || !String.Equals(HashFile(target, null), file.Hash, StringComparison.OrdinalIgnoreCase))))
          throw new IOException("Incomplete backup: " + file.Name);
      });
    }, progress);
  }

  public static void VerifyFiles(string directory, LiraUpdateFile[] files, Action progress) {
    directory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(directory, null);
    if (!Directory.Exists(directory)) throw new DirectoryNotFoundException(directory);
    if (files == null || files.Length == 0) return;
    var verifiedDirs = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    RunParallelWithProgress(delegate {
      Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = ReadParallelism() }, delegate(LiraUpdateFile file) {
        string target = ChildPath(directory, file.Name);
        RequireRegularPathCached(target, directory, verifiedDirs);
        if (Directory.Exists(target)) throw new IOException("An update file is a directory: " + file.Name);
        var info = new FileInfo(target);
        if (!info.Exists || info.Length != file.Length ||
            String.IsNullOrEmpty(file.Hash) ||
            !String.Equals(HashFile(target, null), file.Hash, StringComparison.OrdinalIgnoreCase))
          throw new IOException("Update file integrity mismatch: " + file.Name);
      });
    }, progress);
  }

  public static void VerifyFilesMetadata(string directory, LiraUpdateFile[] files) {
    directory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(directory, null);
    if (!Directory.Exists(directory)) throw new DirectoryNotFoundException(directory);
    if (files == null || files.Length == 0) return;
    var verifiedDirs = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    foreach (LiraUpdateFile file in files) {
      string target = ChildPath(directory, file.Name);
      RequireRegularPathCached(target, directory, verifiedDirs);
      if (Directory.Exists(target)) throw new IOException("An update file is a directory: " + file.Name);
      var info = new FileInfo(target);
      if (!info.Exists || info.Length != file.Length)
        throw new IOException("Update file integrity mismatch: " + file.Name);
    }
  }

  public static LiraUpdateFile[] InspectFiles(string directory, string[] names, Action progress) {
    directory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
    RequireRegularPath(directory, null);
    var results = new LiraUpdateFile[names == null ? 0 : names.Length];
    if (results.Length == 0) return results;
    var verifiedDirs = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
    RunParallelWithProgress(delegate {
      Parallel.For(0, names.Length, new ParallelOptions { MaxDegreeOfParallelism = ReadParallelism() }, delegate(int i) {
        string name = names[i];
        string target = ChildPath(directory, name);
        RequireRegularPathCached(target, directory, verifiedDirs);
        if (Directory.Exists(target)) throw new IOException("An application file was replaced by a directory: " + name);
        string parent = Path.GetDirectoryName(target);
        while (parent != null && !String.Equals(parent, directory, StringComparison.OrdinalIgnoreCase)) {
          if (File.Exists(parent)) throw new IOException("An application parent is a file: " + name);
          parent = Path.GetDirectoryName(parent);
        }
        var info = new FileInfo(target);
        if (!info.Exists) {
          results[i] = new LiraUpdateFile { Name = name, Length = -1, Hash = null };
        } else {
          results[i] = new LiraUpdateFile { Name = name, Length = info.Length, Hash = HashFile(target, null) };
        }
      });
    }, progress);
    return results;
  }

  public static string CopyAndHash(string source, string destination, long expectedLength, Action progress) {
    byte[] buffer = GetBuffer();
    long copied = 0;
    using (var hash = new SHA256Cng()) {
      using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan))
      using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
        int count;
        while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
          output.Write(buffer, 0, count);
          hash.TransformBlock(buffer, 0, count, buffer, 0);
          copied += count;
          Interlocked.Add(ref SourceReadBytes, count);
          NotifyProgress(progress);
        }
        hash.TransformFinalBlock(new byte[0], 0, 0);
        if (copied != expectedLength) throw new IOException("The file changed while it was being copied.");
        output.Flush(true);
      }
      Interlocked.Increment(ref FilesCopied);
      File.SetLastWriteTimeUtc(destination, File.GetLastWriteTimeUtc(source));
      return BitConverter.ToString(hash.Hash).Replace("-", "");
    }
  }

  public static string HashFile(string file, Action progress) {
    byte[] buffer = GetBuffer();
    using (var hash = new SHA256Cng()) {
      using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan)) {
        int count;
        while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
          hash.TransformBlock(buffer, 0, count, buffer, 0);
          Interlocked.Add(ref VerificationReadBytes, count);
          NotifyProgress(progress);
        }
      }
      hash.TransformFinalBlock(new byte[0], 0, 0);
      return BitConverter.ToString(hash.Hash).Replace("-", "");
    }
  }
}
'@
