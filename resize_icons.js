const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const srcPath = path.join(__dirname, 'electron', 'assets', 'icon.png');
const destDir = path.join(__dirname, 'mobile', 'public');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

Jimp.read(srcPath)
  .then(image => {
    // Resize to 192x192
    image.clone()
      .resize(192, 192)
      .write(path.join(destDir, 'icon-192.png'), (err) => {
        if (err) console.error('Failed to write icon-192.png:', err);
        else console.log('Successfully created icon-192.png');
      });

    // Resize to 512x512
    image.clone()
      .resize(512, 512)
      .write(path.join(destDir, 'icon-512.png'), (err) => {
        if (err) console.error('Failed to write icon-512.png:', err);
        else console.log('Successfully created icon-512.png');
      });
  })
  .catch(err => {
    console.error('Failed to read source icon:', err);
  });
