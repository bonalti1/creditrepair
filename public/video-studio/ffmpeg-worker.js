// The Video Studio's export engine (docs/VIDEO.md): ffmpeg compiled to
// WebAssembly (@ffmpeg/core, single-threaded), run in this worker so the
// console stays responsive while a video renders. Everything happens in the
// browser's memory; nothing is sent anywhere. The core files are self-hosted
// under /vendor/ffmpeg/<version>/ (copied from node_modules by
// scripts/copy-ffmpeg-core.mjs) and loaded only when the editor needs them.
//
// Messages in:  { id, type: "load" | "write" | "exec" | "read" | "delete", data }
// Messages out: { id, type: "ok", data } | { id, type: "error", data } | { type: "log", data }
// Cancel = the page terminates the worker.

let ffmpeg = null;

async function load({ coreURL, wasmURL }) {
  if (ffmpeg) return true;
  const mod = await import(coreURL);
  const create = mod.default;
  if (typeof create !== "function") throw new Error("ffmpeg core did not load");
  ffmpeg = await create({
    // The core reads where its .wasm file is from this hash (the same convention as @ffmpeg/ffmpeg).
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL: "" }))}`,
  });
  ffmpeg.setLogger((data) => self.postMessage({ type: "log", data: data && typeof data === "object" ? String(data.message ?? "") : String(data) }));
  return true;
}

self.onmessage = async ({ data: { id, type, data } }) => {
  try {
    let out = true;
    const transfer = [];
    if (type === "load") out = await load(data);
    else if (!ffmpeg) throw new Error("ffmpeg is not loaded");
    else if (type === "write") ffmpeg.FS.writeFile(data.path, data.bytes);
    else if (type === "exec") {
      ffmpeg.setTimeout(-1);
      ffmpeg.exec(...data.args);
      out = ffmpeg.ret;
      ffmpeg.reset();
    } else if (type === "read") {
      out = ffmpeg.FS.readFile(data.path);
      transfer.push(out.buffer);
    } else if (type === "delete") {
      try {
        ffmpeg.FS.unlink(data.path);
      } catch {
        // Already gone.
      }
    } else throw new Error(`unknown message ${type}`);
    self.postMessage({ id, type: "ok", data: out }, transfer);
  } catch (error) {
    self.postMessage({ id, type: "error", data: String(error && error.message ? error.message : error) });
  }
};
