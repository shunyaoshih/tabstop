// Chrome gives the address bar keyboard focus when a new tab opens. Reloading
// once hands it to the page. Runs before anything renders.
if (!location.search) location.search = 'r';

const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
