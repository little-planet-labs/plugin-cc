// Kinetic-typography building blocks. Entrance components take `at` (and
// optional `exitAt`) as ABSOLUTE song frames: compute them from
// useLine(id).wordFrames or beat times, never from useCurrentFrame().
export {Backdrop, type BackdropProps, type BackdropVariant} from './Backdrop';
export {BeatPulse, type BeatPulseProps} from './BeatPulse';
export {DrawPath, type DrawPathProps} from './DrawPath';
export {FadeUp, type FadeUpProps} from './FadeUp';
export {Flash, type FlashProps} from './Flash';
export {KineticText, type KineticTextProps} from './KineticText';
export {Shake, type ShakeProps} from './Shake';
export {SLAM_SPRING, SlamIn, type SlamFrom, type SlamInProps} from './SlamIn';
export {SNAP_SPRING, SnapIn, type SnapInProps} from './SnapIn';
export {StampWords, type StampWord, type StampWordsProps} from './StampWords';
export {Typewriter, type TypewriterProps} from './Typewriter';
export {DEFAULT_EXIT_FRAMES, useKineticWindow, type KineticTimingProps, type KineticWindow} from './window';
