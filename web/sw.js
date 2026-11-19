// Network-only; exists so Chrome treats the page as an installable app.
self.addEventListener('fetch', function (e) { e.respondWith(fetch(e.request)); });
