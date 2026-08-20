import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/** Betters Agency brand ramp centered on primary #002f87 (brand guide v3,
 * Color Palette page). brand[80] drives colorBrandBackground in light theme. */
const bettersBrand: BrandVariants = {
  10: "#020b21",
  20: "#06133a",
  30: "#081b52",
  40: "#062264",
  50: "#032873",
  60: "#012b7d",
  70: "#002d82",
  80: "#002f87",
  90: "#1e4494",
  100: "#3559a2",
  110: "#4a6eb0",
  120: "#5f83bf",
  130: "#7699cd",
  140: "#8fafdb",
  150: "#aac5e9",
  160: "#c8dcf7"
};

export const bettersLightTheme: Theme = createLightTheme(bettersBrand);

/** Secondary palette from the guide - for accents only, never primary UI. */
export const BETTERS = {
  blue: "#002f87",
  dark: "#24272a",
  teal: "#00bfb2",
  orange: "#ff6b35",
  red: "#db504a"
} as const;
