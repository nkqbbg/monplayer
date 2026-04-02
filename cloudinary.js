const { Worker, isMainThread, parentPort } = require("worker_threads");
const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
require("dotenv").config();

// ===== CONFIG =====
cloudinary.config({
  cloud_name: "dxfplnfuo",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ===== ERROR HELPER =====
function getErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;

  const nested =
    error?.error?.message ||
    error?.response?.data?.error?.message;

  return nested || JSON.stringify(error);
}

// ===== UPLOAD CORE =====
function uploadMultiThread(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "matches",
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          return reject(new Error(getErrorMessage(error)));
        }
        resolve(result.secure_url);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ===== RETRY =====
async function uploadWithRetry(buffer, publicId, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await uploadImage(buffer, publicId);
    } catch (err) {
      if (i === retries) throw err;
      console.log(`🔁 Retry ${i + 1}: ${publicId}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ================= WORKER =================
if (!isMainThread) {
  parentPort.on("message", async (task) => {
    try {
      const buffer = Buffer.from(task.buffer);
      const url = await uploadWithRetry(buffer, task.publicId);

      parentPort.postMessage({
        success: true,
        url,
        publicId: task.publicId,
      });
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: getErrorMessage(error),
        publicId: task.publicId,
      });
    }
  });
}

// ================= MAIN THREAD =================
class WorkerPool {
  constructor(size = 4) {
    this.size = size;
    this.workers = [];
    this.freeWorkers = [];
    this.queue = [];

    for (let i = 0; i < size; i++) {
      const worker = new Worker(__filename);

      worker.on("message", (result) => {
        worker._resolve(result);
        worker._resolve = null;

        this.freeWorkers.push(worker);
        this.next();
      });

      worker.on("error", (err) => {
        if (worker._reject) worker._reject(err);
      });

      this.workers.push(worker);
      this.freeWorkers.push(worker);
    }
  }

  exec(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.queue.length === 0 || this.freeWorkers.length === 0) return;

    const worker = this.freeWorkers.pop();
    const { task, resolve, reject } = this.queue.shift();

    worker._resolve = resolve;
    worker._reject = reject;

    // ⚡ transfer buffer để nhanh hơn
    worker.postMessage(
      {
        buffer: task.buffer,
        publicId: task.publicId,
      },
      [task.buffer.buffer]
    );
  }

  destroy() {
    this.workers.forEach((w) => w.terminate());
  }
}

// ===== EXPORT FUNCTION =====
async function uploadImage(tasks, options = {}) {
  const size = options.threads || 4;
  const pool = new WorkerPool(size);

  try {
    const results = await Promise.all(
      tasks.map((t) =>
        pool.exec({
          buffer: t.buffer,
          publicId: t.publicId,
        })
      )
    );

    return results;
  } finally {
    pool.destroy();
  }
}
// ===== DELETE OLD IMAGES =====
async function deleteOldImages(validIds = [], options = {}) {
  const folder = options.folder || "matches";
  const batchSize = options.batchSize || 100;

  if (!Array.isArray(validIds)) {
    throw new Error("validIds must be array");
  }

  const keepSet = new Set(validIds.map((id) => `${folder}/${id}`));

  let allPublicIds = [];
  let nextCursor = undefined;

  try {
    // ===== LẤY TOÀN BỘ RESOURCE =====
    do {
      const res = await cloudinary.api.resources({
        type: "upload",
        prefix: `${folder}/`,
        max_results: 500,
        next_cursor: nextCursor,
      });

      const resources = res.resources || [];
      allPublicIds.push(...resources.map((r) => r.public_id));

      nextCursor = res.next_cursor;
    } while (nextCursor);

    const toDelete = allPublicIds.filter((id) => !keepSet.has(id));

    if (!toDelete.length) {
      console.log("🧹 No old images to delete");
      return;
    }

    console.log(`🧹 Deleting ${toDelete.length} images...`);

    // ===== DELETE THEO BATCH =====
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);

      try {
        await cloudinary.api.delete_resources(batch);
      } catch (err) {
        console.error("❌ Delete error:", getErrorMessage(err));
      }
    }

    console.log("✅ Cleanup done");
  } catch (err) {
    console.error("❌ Cleanup failed:", getErrorMessage(err));
  }
}
module.exports = {
  uploadImage,
  deleteOldImages,
};
