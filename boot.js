// Runs before anything renders, so a saved theme never flashes the wrong one.
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
