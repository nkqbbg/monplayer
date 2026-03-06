const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
require("dotenv").config();

cloudinary.config({
  cloud_name: "dxfplnfuo",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function getCloudinaryErrorMessage(error) {
  if (!error) return "Unknown Cloudinary error";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;

  const nestedMessage =
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message;
  if (nestedMessage) return String(nestedMessage);

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function assertCloudinaryConfigured() {
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET. Set them in .env or environment variables.",
    );
  }
}

// Kiểm tra xem ảnh đã tồn tại chưa
async function checkImageExists(publicId) {
  assertCloudinaryConfigured();
  try {
    const result = await cloudinary.api.resource(`matches/${publicId}`);
    return result.secure_url;
  } catch (error) {
    const httpCode =
      error?.http_code ||
      error?.error?.http_code ||
      error?.response?.status ||
      error?.statusCode;
    const message = getCloudinaryErrorMessage(error);

    // Cloudinary sometimes signals 404 via message instead of http_code.
    if (httpCode === 404) return null;
    if (typeof message === "string" && /resource not found/i.test(message)) {
      return null;
    }

    throw new Error(message);
  }
}

// upload ảnh từ buffer, nếu đã có thì trả về url luôn
async function uploadImage(buffer, publicId) {
  assertCloudinaryConfigured();
  const cachedUrl = await checkImageExists(publicId);
  if (cachedUrl) {
    console.log(`Image cached: ${publicId}`);
    return cachedUrl;
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "matches",
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          return reject(new Error(getCloudinaryErrorMessage(error)));
        }
        resolve(result.secure_url);
      },
      console.log("Uploading image to Cloudinary..."),
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
}
async function deleteOldImages(validIds) {
  assertCloudinaryConfigured();
  if (!Array.isArray(validIds)) {
    throw new Error("deleteOldImages(validIds) expects an array");
  }

  // Lấy danh sách tất cả ảnh trong folder matches
  let allPublicIds = [];
  let nextCursor = undefined;
  try {
    do {
      const result = await cloudinary.api.resources({
        type: "upload",
        prefix: "matches/",
        max_results: 500,
        next_cursor: nextCursor,
      });

      const resources = Array.isArray(result?.resources)
        ? result.resources
        : [];
      allPublicIds.push(...resources.map((r) => r.public_id));
      nextCursor = result?.next_cursor;
    } while (nextCursor);
  } catch (error) {
    throw new Error(getCloudinaryErrorMessage(error));
  }

  const keepSet = new Set(validIds.map((id) => `matches/${id}`));
  const toDelete = allPublicIds.filter((pid) => !keepSet.has(pid));
  if (toDelete.length === 0) return;

  // Cloudinary delete_resources supports batches; keep it small for reliability.
  const BATCH_SIZE = 100;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    try {
      await cloudinary.api.delete_resources(batch);
    } catch (error) {
      throw new Error(getCloudinaryErrorMessage(error));
    }
  }
}

module.exports = {
  uploadImage,
  deleteOldImages,
};
