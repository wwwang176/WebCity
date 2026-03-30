import { type SaveSlot, listSaves, saveGame } from './SaveManager';
import {
  validateExportFile,
  checkPrototypePollution,
  sanitizeSaveName,
  IMPORT_LIMITS,
} from './SaveValidator';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ExportFile {
  format: 'webcity-save';
  exportVersion: 1;
  exportedAt: string;
  slot: {
    name: string;
    date: string;
    data: string;
    population?: number;
  };
}

export interface ImportResult {
  success: boolean;
  slotId?: number;
  saveName?: string;
  errors?: string[];
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

export function buildExportPayload(slot: SaveSlot): ExportFile {
  return {
    format: 'webcity-save',
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    slot: {
      name: slot.name,
      date: slot.date,
      data: slot.data,
      population: slot.population,
    },
  };
}

export function exportSaveToFile(slot: SaveSlot): void {
  const payload = buildExportPayload(slot);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const safeName = (slot.name || 'webcity-save').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.webcity.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Import — parse & validate (pure, no IndexedDB)                    */
/* ------------------------------------------------------------------ */

export function parseAndValidateImport(
  fileContent: string,
): { ok: true; data: string; name: string; warnings: string[] } | { ok: false; errors: string[] } {
  // 1. Size check
  if (fileContent.length > IMPORT_LIMITS.MAX_FILE_SIZE) {
    return { ok: false, errors: ['File size exceeds maximum allowed size (50 MB)'] };
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return { ok: false, errors: ['Invalid JSON format'] };
  }

  // 3. Prototype pollution check
  if (checkPrototypePollution(parsed)) {
    return { ok: false, errors: ['Prototype pollution detected — file rejected'] };
  }

  // 4. Full validation
  const validation = validateExportFile(parsed);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  // 5. Extract data
  const slot = (parsed as ExportFile).slot;
  const name = sanitizeSaveName(slot.name || 'Imported Save');

  return { ok: true, data: slot.data, name, warnings: validation.warnings };
}

/* ------------------------------------------------------------------ */
/*  Import — full pipeline (validate + store in IndexedDB)            */
/* ------------------------------------------------------------------ */

export async function importSaveFromFile(
  fileContent: string,
  options?: { customName?: string },
): Promise<ImportResult> {
  const result = parseAndValidateImport(fileContent);
  if (!result.ok) {
    return { success: false, errors: result.errors };
  }

  const saveName = options?.customName
    ? sanitizeSaveName(options.customName)
    : result.name;

  // Find next available slot ID
  const saves = await listSaves();
  const usedIds = new Set(saves.map(s => s.id));
  let slotId = 1;
  while (usedIds.has(slotId)) slotId++;

  // Parse population from export
  const parsed = JSON.parse(fileContent) as ExportFile;
  const population = parsed.slot.population;

  // Store in IndexedDB
  await saveGame(slotId, saveName, result.data, population);

  return {
    success: true,
    slotId,
    saveName,
    warnings: result.warnings,
  };
}
