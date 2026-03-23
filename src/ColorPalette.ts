/**
 * Centralized color palette for zone, transport, and infrastructure identity colors.
 * All values stored as numeric hex (0xRRGGBB) for Three.js compatibility.
 * Use toCSS() to convert to '#RRGGBB' string for UI/CSS usage.
 */

export const PALETTE = {
  ZONE: {
    RES_LOW: 0x4caf50,
    RES_LOW_OVERLAY: 0x66bb6a,
    RES_HIGH: 0x2e7d32,
    COM_LOW: 0x2196f3,
    COM_LOW_LIGHT: 0x42a5f5,
    COM_HIGH: 0x1565c0,
    /** Industrial: primary (cursor/minimap) */
    IND: 0xffa726,
    /** Industrial: preview highlight (brighter amber) */
    IND_PREVIEW: 0xffc107,
    /** Office: primary (cursor/minimap) */
    OFFICE: 0xab47bc,
    /** Office: preview highlight (deeper purple) */
    OFFICE_PREVIEW: 0x9c27b0,
  },
  TRANSPORT: {
    BUS: 0xff9800,
    METRO: 0x00bcd4,
    RAIL: 0xff5722,
    FERRY: 0x0097a7,
    FERRY_DOCK: 0x0288d1,
  },
  INFRA: {
    POWER: 0xffeb3b,
    WATER: 0x03a9f4,
    POLICE: 0x3f51b5,
    FIRE: 0xd32f2f,
    HOSPITAL: 0xe91e63,
    SCHOOL: 0x795548,
    SCHOOL_HIGH: 0x6d4c41,
    SCHOOL_UNIV: 0x4e342e,
    PARK: 0x4caf50,
    GARBAGE: 0x795548,
    SEWAGE: 0x607d8b,
    CEMETERY: 0x9e9e9e,
  },
  TOOL: {
    SELECT: 0xffffff,
    ROAD: 0x424242,
    RAIL_TRACK: 0x6d4c2a,
    DEMOLISH: 0xf44336,
    DISTRICT: 0xab47bc,
    AIRPORT: 0x9c27b0,
  },
} as const;

/** Convert numeric hex (0xRRGGBB) to CSS string ('#rrggbb'). */
export function toCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
