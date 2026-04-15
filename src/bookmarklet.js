// ============================================================
// Liked Songs with RNG — Spotify Bookmarklet
// ------------------------------------------------------------
// SETUP (one-time):
//   1. Go to https://developer.spotify.com/dashboard and create an app.
//   2. Host callback.html on GitHub Pages (or any static host).
//   3. In your Spotify app settings, add that URL as a Redirect URI.
//   4. Fill in CLIENT_ID and REDIRECT_URI below.
//   5. Run `npm run build` and use the output as your bookmark URL.
// ============================================================

var CLIENT_ID    = '54e4d713f18a4e11bf270bcbd0e154ff';
var REDIRECT_URI = 'https://braidedcable.github.io/spotify-playlist-utils/callback.html';

var PLAYLIST_NAME  = 'Liked Songs with RNG';
var SCOPES         = 'user-library-read playlist-read-private playlist-modify-public playlist-modify-private';
var TOKEN_KEY      = 'sls_access_token';
var EXPIRY_KEY     = 'sls_token_expiry';
var BASE_URL       = 'https://api.spotify.com/v1';
var CALLBACK_ORIGIN = 'https://braidedcable.github.io';

// ── UI overlay ───────────────────────────────────────────────

function createOverlay() {
  var el = document.createElement('div');
  el.id = 'sls-overlay';
  el.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    'background:#1DB954',
    'color:#fff',
    'font:600 14px/1.5 "Circular",system-ui,sans-serif',
    'padding:14px 20px',
    'border-radius:8px',
    'box-shadow:0 4px 20px rgba(0,0,0,.35)',
    'max-width:320px',
    'word-break:break-word',
    'transition:opacity .4s',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function setStatus(el, msg, isError) {
  el.textContent = msg;
  el.style.background = isError ? '#c0392b' : '#1DB954';
}

function dismissOverlay(el, delay) {
  setTimeout(function () {
    el.style.opacity = '0';
    setTimeout(function () { el.remove(); }, 400);
  }, delay || 4000);
}

// ── PKCE helpers ─────────────────────────────────────────────

function base64urlEncode(buffer) {
  var bytes = new Uint8Array(buffer);
  var str = '';
  for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier() {
  var array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

function generateCodeChallenge(verifier) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    .then(function (buffer) { return base64urlEncode(buffer); });
}

// ── Auth ─────────────────────────────────────────────────────

function getStoredToken() {
  var token  = localStorage.getItem(TOKEN_KEY);
  var expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function authenticate() {
  return new Promise(function (resolve, reject) {
    var existing = getStoredToken();
    if (existing) { resolve(existing); return; }

    var verifier = generateCodeVerifier();
    generateCodeChallenge(verifier).then(function (challenge) {
      var nonce = Math.random().toString(36).slice(2);
      // Pass verifier via state so callback.html can use it for the token exchange
      var state = nonce + '.' + verifier;

      var authUrl = 'https://accounts.spotify.com/authorize' +
        '?client_id='             + encodeURIComponent(CLIENT_ID) +
        '&response_type=code' +
        '&redirect_uri='          + encodeURIComponent(REDIRECT_URI) +
        '&scope='                 + encodeURIComponent(SCOPES) +
        '&state='                 + encodeURIComponent(state) +
        '&code_challenge='        + challenge +
        '&code_challenge_method=S256' +
        '&show_dialog=true';

      var popup = window.open(authUrl, 'sls_auth', 'width=500,height=700,menubar=no,toolbar=no');
      if (!popup) {
        reject(new Error('Popup was blocked. Allow popups for this page and try again.'));
        return;
      }

      function onMessage(event) {
        if (event.origin !== CALLBACK_ORIGIN) return;
        var data = event.data;
        if (!data || !data.type) return;
        window.removeEventListener('message', onMessage);
        clearInterval(timer);
        if (data.type === 'sls_token') {
          console.log('[Liked Songs with RNG] granted scopes:', data.scope);
          localStorage.setItem(TOKEN_KEY,  data.token);
          localStorage.setItem(EXPIRY_KEY, String(Date.now() + data.expiresIn * 1000));
          try { popup.close(); } catch (_) {}
          resolve(data.token);
        } else if (data.type === 'sls_error') {
          reject(new Error(data.error));
        }
      }
      window.addEventListener('message', onMessage);

      var timer = setInterval(function () {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener('message', onMessage);
          if (!getStoredToken()) {
            reject(new Error('Authentication cancelled.'));
          }
        }
      }, 500);
    });
  });
}

// ── Spotify API helpers ───────────────────────────────────────


function spotifyFetch(path, token, options) {
  options = options || {};
  var url = path.startsWith('http') ? path : BASE_URL + path;
  var headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});

  return fetch(url, Object.assign({}, options, { headers: headers }))
    .then(function (res) {
      if (res.status === 204) return null;
      if (res.status === 429) throw new Error('Spotify rate limit hit — wait a moment and try again.');
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || res.statusText;
          throw new Error('Spotify ' + res.status + ' on ' + url + ': ' + msg + ' | ' + JSON.stringify(data));
        }
        return data;
      });
    });
}

function getMe(token) {
  return spotifyFetch('/me', token);
}

function getAllLikedSongs(token, onProgress) {
  var uris = [];
  function fetchPage(url) {
    return spotifyFetch(url, token).then(function (data) {
      data.items.forEach(function (item) {
        if (item.track && item.track.uri && !item.track.uri.startsWith('spotify:local:')) {
          uris.push(item.track.uri);
        }
      });
      onProgress(uris.length, data.total);
      if (data.next) return fetchPage(data.next);
    });
  }
  return fetchPage(BASE_URL + '/me/tracks?limit=50').then(function () { return uris; });
}

function findPlaylist(name, userId, token) {
  function fetchPage(url) {
    return spotifyFetch(url, token).then(function (data) {
      var match = null;
      data.items.some(function (pl) {
        if (pl.name === name && pl.owner.id === userId) { match = pl.id; return true; }
      });
      if (match) return match;
      if (data.next) return fetchPage(data.next);
      return null;
    });
  }
  return fetchPage(BASE_URL + '/me/playlists?limit=50');
}

function createPlaylist(userId, name, token) {
  return spotifyFetch('/me/playlists', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, public: true, description: 'Liked Songs — randomized by bookmarklet' }),
  }).then(function (data) { return data.id; });
}

function replacePlaylistTracks(playlistId, uris, token) {
  var first = uris.slice(0, 100);
  return spotifyFetch('/playlists/' + playlistId + '/items', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: first }),
  }).then(function () {
    var batches = [];
    for (var i = 100; i < uris.length; i += 100) {
      batches.push(uris.slice(i, i + 100));
    }
    return batches.reduce(function (chain, batch) {
      return chain.then(function () {
        return spotifyFetch('/playlists/' + playlistId + '/items', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: batch }),
        });
      });
    }, Promise.resolve());
  });
}

function addTracksToPlaylist(playlistId, uris, token) {
  var batches = [];
  for (var i = 0; i < uris.length; i += 100) {
    batches.push(uris.slice(i, i + 100));
  }
  return batches.reduce(function (chain, batch) {
    return chain.then(function () {
      return spotifyFetch('/playlists/' + playlistId + '/items', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: batch }),
      });
    });
  }, Promise.resolve());
}

// ── Shuffle ───────────────────────────────────────────────────

function fisherYates(array) {
  var arr = array.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// ── Main ──────────────────────────────────────────────────────

(function () {
  var old = document.getElementById('sls-overlay');
  if (old) old.remove();

  var overlay = createOverlay();
  setStatus(overlay, 'Connecting to Spotify…');

  authenticate()
    .then(function (token) {
      setStatus(overlay, 'Fetching your profile…');
      return getMe(token).then(function (me) {
        return { token: token, userId: me.id };
      });
    })
    .then(function (ctx) {
      setStatus(overlay, 'Fetching liked songs…');
      return getAllLikedSongs(ctx.token, function (loaded, total) {
        setStatus(overlay, 'Fetching liked songs… (' + loaded + ' / ' + (total || '?') + ')');
      }).then(function (uris) {
        return Object.assign({}, ctx, { uris: uris });
      });
    })
    .then(function (ctx) {
      setStatus(overlay, 'Shuffling ' + ctx.uris.length + ' songs…');
      var shuffled = fisherYates(ctx.uris);
      return Object.assign({}, ctx, { shuffled: shuffled });
    })
    .then(function (ctx) {
      setStatus(overlay, 'Looking for existing playlist…');
      return findPlaylist(PLAYLIST_NAME, ctx.userId, ctx.token).then(function (id) {
        return Object.assign({}, ctx, { existingId: id });
      });
    })
    .then(function (ctx) {
      if (ctx.existingId) {
        setStatus(overlay, 'Overwriting "' + PLAYLIST_NAME + '"…');
        return replacePlaylistTracks(ctx.existingId, ctx.shuffled, ctx.token)
          .then(function () { return ctx; });
      } else {
        setStatus(overlay, 'Creating "' + PLAYLIST_NAME + '"…');
        return createPlaylist(ctx.userId, PLAYLIST_NAME, ctx.token)
          .then(function (newId) {
            return addTracksToPlaylist(newId, ctx.shuffled, ctx.token)
              .then(function () { return ctx; });
          });
      }
    })
    .then(function (ctx) {
      var verb = ctx.existingId ? 'updated' : 'created';
      setStatus(overlay, '"' + PLAYLIST_NAME + '" ' + verb + ' with ' + ctx.shuffled.length + ' tracks!');
      dismissOverlay(overlay, 5000);
    })
    .catch(function (err) {
      setStatus(overlay, 'Error: ' + err.message, true);
      dismissOverlay(overlay, 8000);
      console.error('[Liked Songs with RNG]', err);
    });
})();
