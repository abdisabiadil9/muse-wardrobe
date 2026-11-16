import test from 'node:test';
import assert from 'node:assert/strict';
import { garments } from './data.ts';
import {
  sceneNames, scenePresets, hydrateSceneState, rememberCurrentScene,
  switchScene, restoreSceneRecommendation, openLookInScene, hasSceneChanges,
} from './sceneOutfits.ts';

const defaultState = () => hydrateSceneState({
  scene: '轻松日常', outfit: { ...scenePresets['轻松日常'].outfit },
  saved: [{ id: 'user-saved', outfit: { ...scenePresets['见面时刻'].outfit } }],
  favorites: ['red-knit'], uploads: [{ id: 'user-photo', image: 'data:image/png;base64,user-photo' }],
});
const layout = () => Object.fromEntries(['coat','top','bottom','shoes','bag'].map((slot, index) => [slot, { x: 20 + index * 7, y: 30 + index * 9, width: 25 + index, rotation: index * 2 }]));

test('each scene changes at least two visible garments and uses only owned items', () => {
  for (const scene of sceneNames) {
    for (const id of Object.values(scenePresets[scene].outfit)) assert.equal(garments.find(g => g.id === id)?.owned, true, `${scene}: ${id}`);
    for (const other of sceneNames.filter(value => value !== scene)) {
      const count = Object.keys(scenePresets[scene].outfit).filter(slot => scenePresets[scene].outfit[slot] !== scenePresets[other].outfit[slot]).length;
      assert.ok(count >= 2, `${scene} and ${other} should visibly differ`);
    }
  }
});

test('legacy untouched neutral outfit gets the selected scene preset without resetting user records', () => {
  const saved = [{ id: 'irreplaceable-saved', title: '我的搭配' }];
  const old = { scene: '周末漫步', outfit: { ...scenePresets['轻松日常'].outfit }, saved, favorites: ['bag'], uploads: [{ id: 'upload-1' }] };
  const migrated = hydrateSceneState(old);
  assert.deepEqual(migrated.outfit, scenePresets['周末漫步'].outfit);
  assert.equal(migrated.scene, '周末漫步');
  assert.equal(migrated.saved, saved);
  assert.equal(migrated.favorites, old.favorites);
  assert.equal(migrated.uploads, old.uploads);
  assert.equal(migrated.sceneStateVersion, 1);
});

test('legacy edited clothes and layout migrate only into the active scene', () => {
  const edited = { ...scenePresets['轻松日常'].outfit, top: 'upload-custom-knit' };
  const old = { scene: '见面时刻', outfit: edited, canvasLayout: layout(), saved: [] };
  const migrated = hydrateSceneState(old);
  assert.deepEqual(migrated.outfit, edited);
  assert.deepEqual(migrated.canvasLayout, old.canvasLayout);
  const weekend = switchScene(migrated, '周末漫步');
  assert.deepEqual(weekend.outfit, scenePresets['周末漫步'].outfit);
  assert.equal(weekend.canvasLayout, undefined);
  assert.deepEqual(switchScene(weekend, '见面时刻').canvasLayout, old.canvasLayout);
});

test('manual changes and independent canvas layouts survive switching and JSON reload', () => {
  let state = defaultState();
  state = { ...state, outfit: { ...state.outfit, top: 'red-knit' }, canvasLayout: layout() };
  const daily = structuredClone(state);
  state = switchScene(state, '周末漫步');
  assert.equal(state.canvasLayout, undefined);
  state = { ...state, outfit: { ...state.outfit, bottom: 'jeans' }, canvasLayout: { ...layout(), coat: { x: 75, y: 12, width: 35, rotation: 15 } } };
  const weekend = structuredClone(state);
  state = hydrateSceneState(JSON.parse(JSON.stringify(rememberCurrentScene(state))));
  assert.equal(state.scene, '周末漫步');
  assert.deepEqual(state.outfit, weekend.outfit);
  state = switchScene(state, '轻松日常');
  assert.deepEqual(state.outfit, daily.outfit);
  assert.deepEqual(state.canvasLayout, daily.canvasLayout);
  state = switchScene(state, '周末漫步');
  assert.deepEqual(state.outfit, weekend.outfit);
  assert.deepEqual(state.canvasLayout, weekend.canvasLayout);
});

test('restoring one scene leaves other drafts and saved looks untouched', () => {
  let state = defaultState();
  state = { ...state, outfit: { ...state.outfit, top: 'red-knit' } };
  state = switchScene(state, '周末漫步');
  state = { ...state, outfit: { ...state.outfit, coat: 'oat' }, canvasLayout: layout(), confirmedLook: { day: 'today', signature: 'old' } };
  const saved = state.saved;
  assert.equal(hasSceneChanges(state), true);
  const restored = restoreSceneRecommendation(state);
  assert.deepEqual(restored.outfit, scenePresets['周末漫步'].outfit);
  assert.equal(restored.canvasLayout, undefined);
  assert.equal(restored.confirmedLook, undefined);
  assert.equal(hasSceneChanges(restored), false);
  assert.equal(restored.saved, saved);
  assert.equal(switchScene(restored, '轻松日常').outfit.top, 'red-knit');
});

test('opening a saved look preserves outgoing edits and applies its own layout only to the destination', () => {
  let state = defaultState();
  state = { ...state, outfit: { ...state.outfit, coat: 'lilac-cardigan' }, canvasLayout: layout() };
  const outgoing = structuredClone(state);
  const imported = openLookInScene(state, '见面时刻', { outfit: { ...scenePresets['见面时刻'].outfit, bottom: 'mint-pants' } });
  assert.equal(imported.scene, '见面时刻');
  assert.equal(imported.outfit.bottom, 'mint-pants');
  assert.equal(imported.canvasLayout, undefined);
  const returned = switchScene(imported, '轻松日常');
  assert.deepEqual(returned.outfit, outgoing.outfit);
  assert.deepEqual(returned.canvasLayout, outgoing.canvasLayout);
});

test('already migrated neutral manual combinations are not remigrated on refresh', () => {
  let state = switchScene(defaultState(), '周末漫步');
  state = { ...state, outfit: { ...scenePresets['轻松日常'].outfit } };
  const loaded = hydrateSceneState(JSON.parse(JSON.stringify(rememberCurrentScene(state))));
  assert.deepEqual(loaded.outfit, state.outfit);
  assert.equal(loaded.scene, '周末漫步');
});

test('explicit confirmation or layout keeps a legacy neutral outfit as the user chose it', () => {
  const outfit = { ...scenePresets['轻松日常'].outfit };
  const confirmed = hydrateSceneState({ scene: '周末漫步', outfit, confirmedLook: { day: 'today', signature: 'confirmed-neutral' } });
  assert.deepEqual(confirmed.outfit, outfit);
  assert.equal(confirmed.confirmedLook.signature, 'confirmed-neutral');
  const arranged = hydrateSceneState({ scene: '周末漫步', outfit, canvasLayout: layout() });
  assert.deepEqual(arranged.outfit, outfit);
  assert.deepEqual(arranged.canvasLayout, layout());
});
