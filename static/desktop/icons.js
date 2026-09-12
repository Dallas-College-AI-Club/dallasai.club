export const icon = (type, small = false) => /* HTML */ `
  <svg
    class="r95-icon${small ? ' small' : ''}"
    viewBox="0 0 32 32"
    aria-hidden="true"
    shape-rendering="crispEdges"
  >
    <use href="assets/retro-icons.svg#${type}" />
  </svg>
`;

export const aboutIcon = /* HTML */ `
  <img
    class="r95-icon"
    src="assets/about-browser.svg"
    width="32"
    height="32"
    alt=""
    aria-hidden="true"
  />
`;

export const flagIcon = /* HTML */ `
  <img
    class="r95-icon"
    src="assets/windows95-flag.svg"
    width="32"
    height="32"
    alt=""
    aria-hidden="true"
  />
`;
