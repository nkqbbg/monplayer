// const { v2: cloudinary } = require("cloudinary");
// require("dotenv").config();
// async function uploadImage(path, publicId) {
//   // Configuration
//   cloudinary.config({
//     cloud_name: "dxfplnfuo",
//     api_key: process.env.CLOUDINARY_API_KEY, // Click 'View API Keys' above to copy your API key
//     api_secret: process.env.CLOUDINARY_API_SECRET, // Click 'View API Keys' above to copy your API secret
//   });

//   // Upload an image
//   const uploadResult = await cloudinary.uploader.upload_stream(path, {
//     public_id: publicId,
//   });

//   console.log(uploadResult);

//   // Optimize delivery by resizing and applying auto-format and auto-quality
//   const optimizeUrl = cloudinary.url(publicId, {
//     fetch_format: "auto",
//     quality: "auto",
//   });

//   //   console.log(optimizeUrl);
//   return optimizeUrl;

//   //   // Transform the image: auto-crop to square aspect_ratio
//   //   const autoCropUrl = cloudinary.url(publicId, {
//   //     crop: "auto",
//   //     gravity: "auto",
//   //     width: 500,
//   //     height: 500,
//   //   });

//   //   console.log(autoCropUrl);
// }

// module.exports = {
//   uploadImage,
// };
const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
require("dotenv").config();

// config chỉ chạy 1 lần
cloudinary.config({
  cloud_name: "dxfplnfuo",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// upload ảnh từ buffer
async function uploadImage(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "matches",
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary error:", error);
          return reject(error);
        }

        resolve(result.secure_url);
      },
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// xoá toàn bộ ảnh trong folder matches
async function clearMatchesFolder() {
  await cloudinary.api.delete_resources_by_prefix("matches/");
  await cloudinary.api.delete_folder("matches").catch(() => {});
}

module.exports = {
  uploadImage,
  clearMatchesFolder,
};
