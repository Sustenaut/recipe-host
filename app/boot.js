// The one script a site page includes. It reads its own data- attributes,
// then loads the app's stylesheet and module from wherever this file was
// loaded from (normally jsDelivr, at a pinned version):
//
//   <script src="https://cdn.jsdelivr.net/gh/schryer/recipe-host@v0.1.0/app/boot.js"
//           data-repo="schryer/recipes"></script>
//
//   data-repo     the recipe repository on GitHub (required)
//   data-data     where the built site data lives; default: the latest
//                 commit of the repo's `site` branch, through jsDelivr
//   data-branch   the branch recipes are edited on (default main)
//   data-marked   the Markdown renderer module (default: marked on jsDelivr)
(function () {
  var me = document.currentScript;
  var app = new URL('.', me.src).href;
  var repo = me.dataset.repo;
  window.RECIPE_HOST = {
    repo: repo,
    branch: me.dataset.branch || 'main',
    data: me.dataset.data ? new URL(me.dataset.data, location.href).href : null,
  };
  if (!document.querySelector('script[type="importmap"]')) {
    var map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({
      imports: { marked: me.dataset.marked || 'https://cdn.jsdelivr.net/npm/marked@18.0.14/lib/marked.esm.js' },
    });
    document.head.appendChild(map);
  }
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = app + 'style.css';
  document.head.appendChild(css);
  var main = document.createElement('script');
  main.type = 'module';
  main.src = app + 'main.js';
  document.head.appendChild(main);
})();
