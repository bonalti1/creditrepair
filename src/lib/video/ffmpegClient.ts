"use client";

// The page's side of the export engine (public/video-studio/ffmpeg-worker.js):
// a module worker that loads ffmpeg.wasm only when asked, so the console's
// first paint never waits for it. Cancel = terminate the worker (the next
// export starts a fresh one).

/** The version copied to public/vendor/ffmpeg/ (scripts/copy-ffmpeg-core.mjs); a test keeps it equal to package.json. */
export const FFMPEG_CORE_VERSION = "0.12.10";
export const FFMPEG_CORE_URL = `/vendor/ffmpeg/${FFMPEG_CORE_VERSION}/ffmpeg-core.js`;
export const FFMPEG_WASM_URL = `/vendor/ffmpeg/${FFMPEG_CORE_VERSION}/ffmpeg-core.wasm`;
export const FFMPEG_WORKER_URL = "/video-studio/ffmpeg-worker.js";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class FfmpegEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;
  private loaded = false;
  private logListeners = new Set<(line: string) => void>();
  /** The last lines ffmpeg wrote (for a plain error message). */
  readonly tail: string[] = [];

  onLog(listener: (line: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(FFMPEG_WORKER_URL, { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id?: number; type: string; data: unknown }>) => {
      if (data.type === "log") {
        const line = String(data.data ?? "");
        this.tail.push(line);
        if (this.tail.length > 60) this.tail.shift();
        for (const listener of this.logListeners) listener(line);
        return;
      }
      const waiting = data.id !== undefined ? this.pending.get(data.id) : undefined;
      if (!waiting) return;
      this.pending.delete(data.id!);
      if (data.type === "ok") waiting.resolve(data.data);
      else waiting.reject(new Error(String(data.data)));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The export engine stopped.");
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(type: string, data: unknown, transfer: Transferable[] = []): Promise<T> {
    const worker = this.start();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, type, data }, transfer);
    });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.send("load", { coreURL: new URL(FFMPEG_CORE_URL, window.location.origin).href, wasmURL: new URL(FFMPEG_WASM_URL, window.location.origin).href });
    this.loaded = true;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    // A copy is sent (transferred), so the caller's bytes stay usable.
    const copy = bytes.slice();
    await this.send("write", { path, bytes: copy }, [copy.buffer]);
  }

  /** Runs ffmpeg; resolves with its exit code (0 = it worked). */
  async exec(args: string[]): Promise<number> {
    return Number(await this.send<number>("exec", { args }));
  }

  async read(path: string): Promise<Uint8Array> {
    return this.send<Uint8Array>("read", { path });
  }

  async remove(path: string): Promise<void> {
    await this.send("delete", { path });
  }

  /** Stop at once (cancel): whatever was running is dropped with the worker. */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = false;
    const error = new Error("cancelled");
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }
}
