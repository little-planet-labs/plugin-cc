// Optional motion kit: springs that settle exactly, masked word reveals that
// hold still and leave with designed exits, the world/lyric layer pair, a
// world-only shot timeline with transitions, a world camera settle, subframe
// motion blur, a shatter, a feathered text scrim, deterministic grain,
// beat-free energy swells, a circle flood and log-space zoom. Everything is
// placed on ABSOLUTE song frames (useSongFrame), like the kinetic kit.
export {
  CircleFlood,
  floodGeometry,
  type CircleFloodProps,
  type FloodContract,
  type FloodGeometry,
  type FloodRing,
} from './CircleFlood';
export {Grain, type GrainProps} from './Grain';
export {LyricLayer, TextOnlyContext, useTextOnly, WorldLayer, type LayerProps, type LayerStyle} from './layers';
export {EXIT_GAP, MaskedWords, maskedExitPlan, type ExitPlan, type ExitPlanInput, type MaskedExit, type MaskedWordsProps} from './MaskedWords';
export {Scrim, type ScrimProps} from './Scrim';
export {buildShards, offsetPolygon, SHARD_OVERLAP, Shatter, type Shard, type ShardOptions, type ShardPoint, type ShatterProps} from './Shatter';
export {
  ShotTimeline,
  shotAt,
  shotWindows,
  transitionFrames,
  validateShots,
  type Shot,
  type ShotFrame,
  type ShotProps,
  type ShotTimelineProps,
  type ShotWindow,
  type TransitionSpec,
} from './ShotTimeline';
export {EASE_CAM, EASE_OUT, logZoom, settleFrames, SPRING_PRESETS, springSettled, type SpringPreset} from './springs';
export {SubframeBlur, subframeSamples, type SubframeBlurProps, type SubframeOptions} from './SubframeBlur';
export {useEnergySwell, type EnergySwellOptions} from './useEnergySwell';
export {shotCameraAt, useShotCamera} from './useShotCamera';
