import type {ReactNode} from 'react';
import type {PlacedSection} from '../lib/sections';

/** Props every scene gets: the section it's playing (id, variant, frame range, start/end seconds). */
export type SceneProps = {section: PlacedSection};

/**
 * A scene component. The composition renders it inside
 * `<Sequence from={section.from} durationInFrames={section.durationInFrames}>`,
 * so useCurrentFrame() is section-relative; use useSongFrame(), useLine() and
 * the kinetic components (ABSOLUTE frames) for anything synced to the song.
 */
export type SceneComponent = (props: SceneProps) => ReactNode;
