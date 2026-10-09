// Optional motion kit: springs that settle exactly, masked word reveals that
// hold still, a feathered text scrim, deterministic grain, beat-free energy
// swells, a circle-flood wipe and log-space zoom. Everything is placed on
// ABSOLUTE song frames (useSongFrame), like the kinetic kit.
export {CircleFlood, type CircleFloodProps} from './CircleFlood';
export {Grain, type GrainProps} from './Grain';
export {MaskedWords, type MaskedWordsProps} from './MaskedWords';
export {Scrim, type ScrimProps} from './Scrim';
export {EASE_CAM, EASE_OUT, logZoom, settleFrames, SPRING_PRESETS, springSettled, type SpringPreset} from './springs';
export {useEnergySwell, type EnergySwellOptions} from './useEnergySwell';
