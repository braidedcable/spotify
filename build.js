// Build script — produces dist/bookmarklet.txt
// Usage: npm run build

const fs   = require('fs');
const path = require('path');
const { minify } = require('terser');

const SRC  = path.join(__dirname, 'src', 'bookmarklet.js');
const DIST = path.join(__dirname, 'dist');
const OUT  = path.join(DIST, 'bookmarklet.txt');

async function build() {
  const source = fs.readFileSync(SRC, 'utf8');

  const result = await minify(source, {
    compress: {
      drop_console: false,   // keep console.error for debugging
      passes: 2,
    },
    mangle: true,
    format: {
      comments: false,
    },
  });

  if (result.error) throw result.error;

  const minified = result.code;

  // Wrap in a self-invoking function and URL-encode for use as a bookmark href
  const bookmarklet = 'javascript:' + encodeURIComponent('(function(){' + minified + '})()');

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
  fs.writeFileSync(OUT, bookmarklet, 'utf8');

  console.log('✔ Built successfully.');
  console.log('  Output : ' + OUT);
  console.log('  Size   : ' + (bookmarklet.length / 1024).toFixed(1) + ' KB (URL-encoded)');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open your browser bookmark manager.');
  console.log('  2. Create a new bookmark.');
  console.log('  3. Paste the contents of dist/bookmarklet.txt as the URL.');
  console.log('  4. Click the bookmark on any page to run it.');
}

build().catch(function (err) {
  console.error('Build failed:', err.message || err);
  process.exit(1);
});
