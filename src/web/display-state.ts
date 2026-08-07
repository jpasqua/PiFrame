import type { DisplaySettings } from "../core/settings.js";
import type { PhotoRecord } from "../data/photo-repository.js";
export { isDisplayOn } from "../core/schedule.js";

export function selectDisplayPhotos(photos: PhotoRecord[], settings: DisplaySettings, afterId: string | null): PhotoRecord[] {
  return selectDisplaySlide(photos, settings, afterId, 0).photos;
}

export type DisplayLayout = "single" | "portrait-pair" | "landscape-pair" | "landscape-side-pair" | "portrait-triptych" | "portrait-landscape-trio" | "landscape-trio" | "portrait-trio";

export interface DisplaySlide { layout: DisplayLayout; photos: PhotoRecord[]; cursor: string | null; advanceCount: number; }

/** A local shuffled deck gives random playback an actual upcoming sequence to plan against. */
export class RandomDisplayPlanner {
  private readonly decks = new Map<string, RandomDeck>();
  private static readonly lookaheadCount = 16;

  next(sessionId: string, photos: PhotoRecord[], settings: DisplaySettings, displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
    const deck = this.decks.get(sessionId) ?? { ids: [], sourceKey: "" };
    this.decks.set(sessionId, deck);
    const key = photos.map((photo) => photo.id).sort().join("|");
    if (key !== deck.sourceKey) { deck.sourceKey = key; deck.ids = []; }
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    this.fillDeck(deck, photos);
    const candidates = deck.ids.slice(0, Math.min(RandomDisplayPlanner.lookaheadCount, deck.ids.length)).map((id) => byId.get(id)).filter((photo): photo is PhotoRecord => photo !== undefined);
    const slide = settings.screenLayout === "single"
      ? selectSlideFromCandidates(candidates, settings, displayOrientation)
      : chooseRandomAdaptiveLayout(candidates, displayOrientation);
    // The first card is the random deck's primary photo. Any companions were
    // borrowed from the look-ahead window and remain available for later slides.
    deck.ids.splice(0, slide.advanceCount);
    return slide;
  }

  private fillDeck(deck: RandomDeck, photos: PhotoRecord[]): void {
    if (deck.ids.length >= RandomDisplayPlanner.lookaheadCount || photos.length === 0) return;
    const pending = new Set(deck.ids);
    deck.ids.push(...shuffle(photos.map((photo) => photo.id).filter((id) => !pending.has(id))));
  }
}

interface RandomDeck { ids: string[]; sourceKey: string; }

export function selectDisplaySlide(photos: PhotoRecord[], settings: DisplaySettings, afterId: string | null, displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  if (photos.length === 0) return { layout: "single", photos: [], cursor: null, advanceCount: 0 };
  const candidates = settings.orderMode === "random"
    ? selectRandomPhotos(photos, Math.min(3, photos.length), afterId)
    : selectOrderedPhotos(photos, Math.min(4, photos.length), afterId, settings);
  return selectSlideFromCandidates(candidates, settings, displayOrientation);
}

function selectSlideFromCandidates(candidates: PhotoRecord[], settings: DisplaySettings, displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  if (settings.screenLayout === "single") {
    const selected = candidates.slice(0, 1);
    return { layout: "single", photos: selected, cursor: selected[0]?.id ?? null, advanceCount: selected.length };
  }
  return chooseAdaptiveLayout(candidates, displayOrientation);
}

function selectOrderedPhotos(photos: PhotoRecord[], count: number, afterId: string | null, settings: DisplaySettings): PhotoRecord[] {
  const ordered = [...photos].sort((left, right) => compareDisplayPhotos(left, right, settings));
  const afterIndex = afterId ? ordered.findIndex((photo) => photo.id === afterId) : -1;
  return Array.from({ length: count }, (_, index) => ordered[(Math.max(afterIndex, -1) + 1 + index) % ordered.length]).filter((photo): photo is PhotoRecord => photo !== undefined);
}

/**
 * In random multi-photo mode, the first card remains the primary deck item.
 * We examine a wider window only to borrow companions that make that primary
 * photo use the screen better; companions are deliberately not consumed.
 */
function chooseRandomAdaptiveLayout(candidates: PhotoRecord[], displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  const primary = candidates[0];
  if (!primary) return { layout: "single", photos: [], cursor: null, advanceCount: 0 };

  const portraitScreen = displayOrientation === 90 || displayOrientation === 270;
  const screenAspect = portraitScreen ? 9 / 16 : 16 / 9;
  const options: Array<{ layout: DisplayLayout; photos: PhotoRecord[]; score: number }> = [{
    layout: "single",
    photos: [primary],
    score: containedCoverage(primary, screenAspect)
  }];

  if (!portraitScreen) {
    const tallCandidates = candidates.filter(isTall);
    const pair = firstCombinationIncludingPrimary(primary, tallCandidates, 2);
    if (pair) options.push({
      layout: "portrait-pair",
      photos: pair,
      score: averageCoverage(pair, screenAspect / 2)
    });
    const triptych = firstCombinationIncludingPrimary(primary, tallCandidates, 3);
    if (triptych) options.push({
      layout: "portrait-triptych",
      photos: triptych,
      score: averageCoverage(triptych, screenAspect / 3)
    });
    const portraitLandscapeTrio = firstPortraitLandscapeTrioIncludingPrimary(primary, candidates);
    if (portraitLandscapeTrio) options.push({
      layout: "portrait-landscape-trio",
      photos: portraitLandscapeTrio,
      score: portraitLandscapeTrioCoverage(portraitLandscapeTrio, screenAspect)
    });
  } else {
    const wideCandidates = candidates.filter(isWide);
    const pair = firstCombinationIncludingPrimary(primary, wideCandidates, 2);
    if (pair) options.push({
      layout: "landscape-pair",
      photos: pair,
      score: averageCoverage(pair, screenAspect * 2)
    });
    const trio = firstPortraitTrioIncludingPrimary(primary, candidates);
    if (trio) options.push({
      layout: "portrait-trio",
      photos: trio,
      score: portraitTrioCoverage(trio, screenAspect)
    });
  }

  const best = options.reduce((winner, option) => option.score > winner.score ? option : winner);
  return { layout: best.layout, photos: best.photos, cursor: primary.id, advanceCount: 1 };
}

function firstCombinationIncludingPrimary(primary: PhotoRecord, candidates: PhotoRecord[], count: number): PhotoRecord[] | null {
  if (!candidates.includes(primary)) return null;
  const companions = candidates.filter((photo) => photo.id !== primary.id).slice(0, count - 1);
  return companions.length === count - 1 ? [primary, ...companions] : null;
}

function firstPortraitTrioIncludingPrimary(primary: PhotoRecord, candidates: PhotoRecord[]): PhotoRecord[] | null {
  for (let first = 1; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const arranged = arrangePortraitTrio([primary, candidates[first]!, candidates[second]!]);
      if (arranged) return arranged;
    }
  }
  return null;
}

function firstPortraitLandscapeTrioIncludingPrimary(primary: PhotoRecord, candidates: PhotoRecord[]): PhotoRecord[] | null {
  for (let first = 1; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const arranged = arrangePortraitLandscapeTrio([primary, candidates[first]!, candidates[second]!]);
      if (arranged) return arranged;
    }
  }
  return null;
}

function arrangePortraitTrio(photos: PhotoRecord[]): PhotoRecord[] | null {
  for (const wide of photos) {
    const tall = photos.filter((photo) => photo.id !== wide.id);
    if (isWide(wide) && tall.length === 2 && tall.every(isTall)) return [...tall, wide];
  }
  return null;
}

function arrangePortraitLandscapeTrio(photos: PhotoRecord[]): PhotoRecord[] | null {
  for (const portrait of photos) {
    const landscapes = photos.filter((photo) => photo.id !== portrait.id);
    if (isTall(portrait) && landscapes.length === 2 && landscapes.every(isWide)) return [portrait, ...landscapes];
  }
  return null;
}

function averageCoverage(photos: PhotoRecord[], panelAspect: number): number {
  return photos.reduce((total, photo) => total + containedCoverage(photo, panelAspect), 0) / photos.length;
}

function portraitTrioCoverage(photos: PhotoRecord[], screenAspect: number): number {
  const [topLeft, topRight, bottom] = photos;
  if (!topLeft || !topRight || !bottom) return 0;
  const topPanelAspect = screenAspect / 1.18;
  const bottomPanelAspect = screenAspect / .82;
  return .59 * averageCoverage([topLeft, topRight], topPanelAspect) + .41 * containedCoverage(bottom, bottomPanelAspect);
}

function portraitLandscapeTrioCoverage(photos: PhotoRecord[], screenAspect: number): number {
  const [portrait, topLandscape, bottomLandscape] = photos;
  if (!portrait || !topLandscape || !bottomLandscape) return 0;
  const portraitPanelAspect = screenAspect * .37;
  const landscapePanelAspect = screenAspect * 1.26;
  return .37 * containedCoverage(portrait, portraitPanelAspect) + .63 * averageCoverage([topLandscape, bottomLandscape], landscapePanelAspect);
}

function containedCoverage(photo: PhotoRecord, panelAspect: number): number {
  const imageAspect = photoAspect(photo);
  return Math.min(imageAspect / panelAspect, panelAspect / imageAspect);
}

function isTall(photo: PhotoRecord): boolean {
  return photoShape(photo) !== "landscape";
}

function isWide(photo: PhotoRecord): boolean {
  return photoShape(photo) !== "portrait";
}

function chooseAdaptiveLayout(candidates: PhotoRecord[], displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  const portraitScreen = displayOrientation === 90 || displayOrientation === 270;
  const options: Array<{ layout: DisplayLayout; photos: PhotoRecord[]; score: number }> = [{ layout: "single", photos: candidates.slice(0, 1), score: 1 }];
  const pair = candidates.slice(0, 2);
  const desiredPairShape = portraitScreen ? "landscape" : "portrait";
  if (pair.length === 2 && pair.every((photo) => photoShape(photo) === desiredPairShape)) {
    options.push({ layout: portraitScreen ? "landscape-pair" : "portrait-pair", photos: pair, score: 2.2 });
  }
  if (!portraitScreen && pair.length === 2 && pair.every((photo) => photoShape(photo) === "landscape") && canFormTrio(candidates.slice(1, 4))) {
    options.push({ layout: "landscape-side-pair", photos: pair, score: 2.2 });
  }
  const trio = candidates.slice(0, 3);
  const shapes = trio.map(photoShape);
  if (!portraitScreen && trio.length === 3 && shapes.every((shape) => shape === "portrait")) {
    options.push({ layout: "portrait-triptych", photos: trio, score: 3.3 });
  }
  if (portraitScreen && trio.length === 3 && shapes.filter((shape) => shape === "portrait").length === 2 && shapes.includes("landscape")) {
    options.push({ layout: "portrait-trio", photos: arrangeByShapes(trio, ["portrait", "portrait", "landscape"]), score: 3.1 });
  }
  const best = options.reduce((winner, option) => option.score > winner.score ? option : winner);
  const bridgeToNextTrio = best.photos.length === 2 && canFormTrio(candidates.slice(1, 4));
  const consumed = candidates.slice(0, bridgeToNextTrio ? 1 : best.photos.length);
  return { layout: best.layout, photos: best.photos, cursor: consumed[consumed.length - 1]?.id ?? null, advanceCount: consumed.length };
}

function shuffle<T>(values: T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function canFormTrio(photos: PhotoRecord[]): boolean {
  return photos.length === 3 && photos.filter((photo) => photoShape(photo) === "portrait").length === 2 && photos.some((photo) => photoShape(photo) === "landscape");
}

function arrangeByShapes(photos: PhotoRecord[], wanted: Array<"portrait" | "landscape">): PhotoRecord[] {
  const remaining = [...photos];
  return wanted.map((shape) => {
    const index = remaining.findIndex((photo) => photoShape(photo) === shape);
    return remaining.splice(index >= 0 ? index : 0, 1)[0];
  }).filter((photo): photo is PhotoRecord => photo !== undefined);
}

function photoShape(photo: PhotoRecord): "portrait" | "landscape" | "square" {
  const ratio = photoAspect(photo);
  return ratio < .85 ? "portrait" : ratio > 1.15 ? "landscape" : "square";
}

function photoAspect(photo: PhotoRecord): number {
  let width = photo.widthPx ?? 1;
  let height = photo.heightPx ?? 1;
  if (photo.exifOrientation === 5 || photo.exifOrientation === 6 || photo.exifOrientation === 7 || photo.exifOrientation === 8 || photo.manualRotationDegrees === 90 || photo.manualRotationDegrees === 270) [width, height] = [height, width];
  return width / height;
}

function selectRandomPhotos(photos: PhotoRecord[], count: number, afterId: string | null): PhotoRecord[] {
  const available = photos.filter((photo) => photo.id !== afterId);
  const pool = available.length > 0 ? [...available] : [...photos];
  const selected: PhotoRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    if (pool.length === 0) pool.push(...photos);
    const photo = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (photo) selected.push(photo);
  }
  return selected;
}

function compareDisplayPhotos(left: PhotoRecord, right: PhotoRecord, settings: DisplaySettings): number {
  const { orderMode } = settings;
  if (orderMode === "manual") {
    const folderOrder = new Map(settings.selectedFolderIds.map((folderId, index) => [folderId, index]));
    const leftFolder = folderOrder.get(left.folderId) ?? Number.MAX_SAFE_INTEGER;
    const rightFolder = folderOrder.get(right.folderId) ?? Number.MAX_SAFE_INTEGER;
    const byFolder = leftFolder - rightFolder || left.folderId.localeCompare(right.folderId);
    return byFolder || left.manualPosition - right.manualPosition || left.id.localeCompare(right.id);
  }
  if (orderMode === "filename-asc") return left.originalFilename.localeCompare(right.originalFilename);
  if (orderMode === "filename-desc") return right.originalFilename.localeCompare(left.originalFilename);
  const leftDate = orderMode.startsWith("capture") ? (left.captureDate ?? left.createdAt) : left.createdAt;
  const rightDate = orderMode.startsWith("capture") ? (right.captureDate ?? right.createdAt) : right.createdAt;
  const comparison = leftDate.localeCompare(rightDate);
  return orderMode.endsWith("newest") ? -comparison : comparison;
}
