import React, { useRef } from 'react';

// BMO's face, drawn as inline SVG — no image assets, nothing traced from the show.
// Two eyes + a mouth on a 200x120 canvas; every emotion is just a different shape
// pulled from the tables below, so adding a new expression is adding one entry.

const INK = '#2d482e';
const EYE_Y = 46;
const EYE_L = 66;
const EYE_R = 134;
const MOUTH_CX = 100;
const MOUTH_CY = 84;

// Eye shapes, drawn centered on (0,0) — positioned via a <g transform="translate(...)">.
const EYE_SHAPES = {
  open:    { kind: 'ellipse', rx: 12, ry: 14 },
  wide:    { kind: 'ellipse', rx: 15, ry: 18 },
  small:   { kind: 'ellipse', rx: 7, ry: 8 },
  closed:  { kind: 'path', d: 'M -13 0 H 13', strokeOnly: true },
  arc:     { kind: 'path', d: 'M -14 5 Q 0 -16 14 5', strokeOnly: true }, // happy ^ ^
  droop:   { kind: 'path', d: 'M -14 -3 Q 0 10 14 -3', strokeOnly: true }, // sleepy
  squintL: { kind: 'path', d: 'M -12 -9 L 6 0 L -12 9 Z' },
  squintR: { kind: 'path', d: 'M 12 -9 L -6 0 L 12 9 Z' },
  cross:   { kind: 'path', d: 'M -10 -10 L 10 10 M 10 -10 L -10 10', strokeOnly: true },
  lens:    { kind: 'rect', x: -14, y: -13, w: 28, h: 26, rx: 5 },
};

// Mouth shapes, drawn in absolute coordinates around (MOUTH_CX, MOUTH_CY).
const MOUTH_SHAPES = {
  smile: { kind: 'path', d: 'M 80 78 Q 100 96 120 78', strokeOnly: true },
  grin:  { kind: 'path', d: 'M 74 76 Q 100 110 126 76 Z' },
  flat:  { kind: 'path', d: 'M 84 86 H 116', strokeOnly: true },
  wavy:  { kind: 'path', d: 'M 78 86 Q 89 76 100 86 T 122 86', strokeOnly: true },
  cat:   { kind: 'path', d: 'M 82 82 Q 91 92 100 82 Q 109 92 118 82', strokeOnly: true },
  o:     { kind: 'ellipse', cx: 100, cy: 72, rx: 10, ry: 12 },
  tiny:  { kind: 'ellipse', cx: 100, cy: 80, rx: 5, ry: 6 },
};

// Maps every BMO emotion (from App.jsx EMOTION_MAP) plus every derived UI state
// to an eye pair + mouth. This is the single place that defines "what BMO looks like."
const FACES = {
  happy:     { eyes: ['arc', 'arc'], mouth: 'smile' },
  glasses:   { eyes: ['lens', 'lens'], mouth: 'smile', glasses: true },
  thinking:  { eyes: ['open', 'small'], mouth: 'flat' },
  surprised: { eyes: ['wide', 'wide'], mouth: 'o' },
  silly:     { eyes: ['squintL', 'squintR'], mouth: 'cat' },
  blush:     { eyes: ['arc', 'arc'], mouth: 'wavy', blush: true },
  victory:   { eyes: ['arc', 'arc'], mouth: 'grin', sparkle: true },
  sleeping:  { eyes: ['droop', 'droop'], mouth: 'tiny', zzz: true },
  sleep:     { eyes: ['closed', 'closed'], mouth: 'tiny' },
  // derived (not LLM-selectable — driven by app state, see faceState below)
  offline:   { eyes: ['cross', 'cross'], mouth: 'wavy', glitch: true },
  loading:   { eyes: ['wide', 'wide'], mouth: 'flat', dots: true },
  eating:    { eyes: ['squintL', 'squintR'], mouth: 'grin' },
};

function EyeShape({ shape, ink }) {
  const s = EYE_SHAPES[shape] || EYE_SHAPES.open;
  const common = s.strokeOnly
    ? { fill: 'none', stroke: ink, strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round' }
    : { fill: ink };
  if (s.kind === 'ellipse') return <ellipse cx={0} cy={0} rx={s.rx} ry={s.ry} {...common} />;
  if (s.kind === 'rect') return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...common} />;
  return <path d={s.d} {...common} />;
}

function MouthShape({ shape, ink }) {
  const s = MOUTH_SHAPES[shape] || MOUTH_SHAPES.flat;
  const common = s.strokeOnly
    ? { fill: 'none', stroke: ink, strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round' }
    : { fill: ink };
  if (s.kind === 'ellipse') return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
  return <path d={s.d} {...common} />;
}

/**
 * BMO's face.
 * - emotion: one of the EMOTION_MAP keys ('happy', 'glasses', 'thinking', ...) — what the
 *   LLM picked via [face:xxx].
 * - state: 'offline' | 'loading' | 'eating' | 'speaking' | 'celebrate' | 'idle' — derived
 *   from app booleans (backend health, isLoading, isEating, isSpeaking/isStreaming, isHappy).
 *   Non-idle states override the eyes/mouth shape (you can't look "surprised" while offline);
 *   'speaking' and 'celebrate' keep the LLM's chosen emotion and only change the mouth/motion.
 * - talking: true while TTS is speaking OR tokens are streaming in — flaps the mouth.
 */
export default function BmoFace({ emotion = 'happy', state = 'idle', talking = false, onPoke, ink = INK, className = '' }) {
  const blinkDelay = useRef(`-${(Math.random() * 5).toFixed(2)}s`);

  const overrideKey = state === 'offline' || state === 'loading' || state === 'eating' ? state : emotion;
  const face = FACES[overrideKey] || FACES.happy;
  const mouthKey = talking ? 'grin' : face.mouth;

  const rootClass = [
    'bmo-face',
    state === 'idle' ? 'bmo-idle' : '',
    talking ? 'bmo-talking' : '',
    state === 'eating' ? 'bmo-eating' : '',
    face.glitch ? 'bmo-glitch' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <svg
      viewBox="0 0 200 120"
      className={rootClass}
      role="img"
      aria-label={`BMO looks ${overrideKey}`}
      onClick={onPoke}
      style={{ cursor: onPoke ? 'pointer' : 'default', width: '100%', height: '100%', overflow: 'visible' }}
    >
      {face.blush && (
        <>
          <ellipse cx={38} cy={64} rx={11} ry={7} fill="#ff3b30" opacity={0.28} />
          <ellipse cx={162} cy={64} rx={11} ry={7} fill="#ff3b30" opacity={0.28} />
        </>
      )}

      <g className="bmo-eyes" style={{ transformOrigin: `${(EYE_L + EYE_R) / 2}px ${EYE_Y}px`, animationDelay: blinkDelay.current }}>
        <g transform={`translate(${EYE_L}, ${EYE_Y})`}><EyeShape shape={face.eyes[0]} ink={ink} /></g>
        <g transform={`translate(${EYE_R}, ${EYE_Y})`}><EyeShape shape={face.eyes[1]} ink={ink} /></g>
        {face.glasses && (
          <path
            d={`M ${EYE_L - 22} ${EYE_Y} H ${EYE_L - 18} M ${EYE_R + 18} ${EYE_Y} H ${EYE_R + 22} M ${EYE_L + 14} ${EYE_Y} H ${EYE_R - 14}`}
            stroke={ink} strokeWidth={5} strokeLinecap="round"
          />
        )}
      </g>

      <g className="bmo-mouth" style={{ transformOrigin: `${MOUTH_CX}px ${MOUTH_CY}px` }}>
        <MouthShape shape={mouthKey} ink={ink} />
      </g>

      {face.sparkle && (
        <>
          <path d="M 24 22 L 27 30 L 35 33 L 27 36 L 24 44 L 21 36 L 13 33 L 21 30 Z" fill="#ffcc00" />
          <path d="M 176 22 L 179 30 L 187 33 L 179 36 L 176 44 L 173 36 L 165 33 L 173 30 Z" fill="#ffcc00" />
        </>
      )}

      {face.zzz && (
        <g fill={ink} className="bmo-zzz-group">
          <text x={148} y={30} className="bmo-zzz" style={{ animationDelay: '0s' }} fontSize={16} fontWeight="bold">Z</text>
          <text x={160} y={18} className="bmo-zzz" style={{ animationDelay: '0.4s' }} fontSize={12} fontWeight="bold">Z</text>
          <text x={170} y={8} className="bmo-zzz" style={{ animationDelay: '0.8s' }} fontSize={9} fontWeight="bold">Z</text>
        </g>
      )}

      {face.dots && (
        <g fill={ink}>
          <circle className="bmo-dot" cx={86} cy={104} r={4} />
          <circle className="bmo-dot" cx={100} cy={104} r={4} style={{ animationDelay: '300ms' }} />
          <circle className="bmo-dot" cx={114} cy={104} r={4} style={{ animationDelay: '600ms' }} />
        </g>
      )}
    </svg>
  );
}
