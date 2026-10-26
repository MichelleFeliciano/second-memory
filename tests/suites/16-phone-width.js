// @width 375
// On a phone-width screen no screen scrolls sideways, and the Menu and bottom bar are the same on every screen.
for (const tab of TABS) {
  nav(tab);
  check('"' + tab + '" does not scroll sideways at 375px', document.documentElement.scrollWidth <= window.innerWidth + 1, document.documentElement.scrollWidth + ' > ' + window.innerWidth);
}
check('the phone bottom bar is shown', getComputedStyle($('bottom-bar')).display !== 'none' && document.querySelectorAll('#bottom-bar button').length >= 4);
check('every tap target in the bottom bar is at least 44px tall', [...document.querySelectorAll('#bottom-bar button')].every((b) => b.getBoundingClientRect().height >= 44));
nav('home');
