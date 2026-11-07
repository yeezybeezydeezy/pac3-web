// Built-in example outfits (original designs) showing off each part type.
let n = 0;
const P = (ClassName, props = {}, children = []) => ({ self: { ClassName, UniqueID: props.UniqueID || `ex${++n}`, ...props }, children });
const outfit = (...parts) => ({ format: 'pac3-web', version: 1, parts });

const GOLD = [1, 0.84, 0.35];

function wing(side) {
  const s = side === 'left' ? 1 : -1;
  const feathers = [0, 1, 2, 3].map((i) => P('model', {
    Name: `feather ${i + 1}`, Model: 'sphere', Scale: [2.3 - i * 0.3, 0.45, 0.16],
    Position: [s * (8.8 - i * 1.3), 1.5 - i * 2.6, 0], Angles: [0, 0, s * (-8 - i * 12)], Roughness: 0.9,
  }));
  return P('model', { Name: `${side} wing`, Bone: 'chest', Model: 'sphere', Size: 0.25, Position: [s * 3, 8, -5], Angles: [0, -s * 25, 0] }, [
    P('proxy', { VariableName: 'Angles', Axis: 'y', Expression: `${-s * 25} + sin(time() * 2.5) * ${s * 12}` }),
    ...feathers,
  ]);
}

const hand = (side) => P('group', { Name: `${side} flame` }, [
  P('particles', { Name: 'fire', Bone: `${side} hand`, Position: [0, -4, 0], Angles: [-90, 0, 0], Material: 'soft', FireDelay: 0.02, DieTime: 0.7, StartSize: 5, EndSize: 1, StartColor: [1, 0.85, 0.3], EndColor: [1, 0.15, 0], Velocity: 10, Spread: 0.5, PositionSpread: 1, Gravity: [0, 60, 0], AirResistance: 1, Collide: false }),
  P('particles', { Name: 'smoke', Bone: `${side} hand`, Position: [0, -2, 0], Angles: [-90, 0, 0], Material: 'smoke', FireDelay: 0.08, DieTime: 1.6, StartSize: 3, EndSize: 14, StartColor: [0.4, 0.4, 0.4], EndColor: [0.2, 0.2, 0.2], StartAlpha: 0.35, EndAlpha: 0, Additive: false, Velocity: 8, Spread: 0.3, Gravity: [0, 40, 0], Collide: false, RandomRollSpeed: 90 }),
  P('light', { Bone: `${side} hand`, Position: [0, -4, 0], Color: [1, 0.55, 0.2], Brightness: 6, Size: 70 }, [
    P('proxy', { VariableName: 'Brightness', Expression: 'random(4, 7)' }),
  ]),
]);

export const EXAMPLES = {
  'Angel wings & halo': () => outfit(P('group', { Name: 'angel' }, [
    P('model', { Name: 'halo', Model: 'torus', Bone: 'head', Position: [0, 10, 0], Angles: [90, 0, 0], Size: 0.75, Scale: [1, 1, 0.6], Color: GOLD, Material: 'glow' }, [
      P('proxy', { VariableName: 'Position', Axis: 'y', Expression: '10 + sin(time() * 2) * 0.8' }),
      P('halo', { Color: GOLD, Width: 0.5, Alpha: 0.6 }),
    ]),
    P('sprite', { Name: 'halo glow', Bone: 'head', Position: [0, 10, 0], Color: GOLD, Size: 16, Alpha: 0.45 }),
    P('light', { Bone: 'head', Position: [0, 13, 0], Color: GOLD, Brightness: 4, Size: 90 }),
    wing('left'),
    wing('right'),
  ])),

  'Fire hands': () => outfit(P('group', { Name: 'fire hands' }, [hand('left'), hand('right')])),

  'Robot head': () => outfit(P('group', { Name: 'robot' }, [
    P('bone', { Bone: 'head', HideMesh: true }),
    P('model', { Name: 'head', Bone: 'head', Model: 'cube', Position: [0, 4, 0.4], Scale: [1.15, 1.1, 1.15], Color: [0.62, 0.66, 0.72], Metalness: 0.8, Roughness: 0.3 }, [
      P('model', { Name: 'visor', Model: 'cube', Position: [0, 1, 4.6], Scale: [0.9, 0.22, 0.05], Color: [0.08, 0.02, 0.02], Roughness: 0.2 }),
      P('sprite', { Name: 'scanner eye', Position: [0, 1, 5], Color: [1, 0.15, 0.1], Size: 5 }, [
        P('proxy', { VariableName: 'Position', Axis: 'x', Expression: 'sin(time() * 3) * 3' }),
      ]),
      P('jiggle', { Name: 'antenna', Position: [2.5, 4, 0], Strain: 0.75, Speed: 1.2 }, [
        P('model', { Model: 'cylinder', Position: [0, 4, 0], Scale: [0.08, 1, 0.08], Color: [0.3, 0.3, 0.35], Metalness: 1, Roughness: 0.3 }),
        P('model', { Name: 'tip', Model: 'sphere', Position: [0, 8, 0], Size: 0.3, Color: [1, 0.2, 0.15], Material: 'glow' }, [
          P('proxy', { VariableName: 'Brightness', Expression: 'nsin(time() * 6) + 0.4' }),
        ]),
      ]),
    ]),
    P('text', { Name: 'greeting', Bone: 'head', Position: [0, 16, 0], Text: 'HELLO, HUMAN', Color: [1, 0.3, 0.25], Font: 'Courier New', Size: 0.6 }, [
      P('event', { Event: 'say', Operator: 'find simple', Arguments: 'hello@@4' }),
      P('sound', { Path: 'blip', PlayCount: 3, Pitch: 1.4 }),
    ]),
    P('info', { Text: 'Say "hello" in play-mode chat (T) to make the robot answer.' }),
  ])),

  'Party mode (pac_event)': () => outfit(P('group', { Name: 'party' }, [
    P('event', { Event: 'command', Arguments: 'party' }),
    P('animation', { SequenceName: 'dance' }),
    P('light', { Bone: 'head', Position: [0, 30, 0], Brightness: 10, Size: 250 }, [
      P('proxy', { VariableName: 'Color', Expression: 'hsv_to_color(time() * 120, 1, 1)' }),
    ]),
    P('particles', { Name: 'confetti', Bone: 'head', Position: [0, 10, 0], Angles: [-90, 0, 0], Material: 'square', FireDelay: 0.05, NumberParticles: 3, DieTime: 3, StartSize: 2, EndSize: 2, StartColor: [1, 1, 1], EndColor: [1, 1, 1], RandomColor: true, StartAlpha: 1, EndAlpha: 1, Additive: false, Velocity: 120, Spread: 0.6, Gravity: [0, -150, 0], AirResistance: 1, Bounce: 0.2, RollDelta: 360, RandomRollSpeed: 360 }),
    P('text', { Bone: 'head', Position: [0, 18, 0], Text: 'PARTY!', Font: 'Impact', Size: 0.8 }, [
      P('proxy', { VariableName: 'Color', Expression: 'hsv_to_color(time() * 200 + 180, 0.8, 1)' }),
      P('proxy', { VariableName: 'Size', Expression: '0.8 + nsin(time() * 8) * 0.15' }),
    ]),
    P('sound', { Path: 'powerup' }),
  ]), P('group', { Name: 'how to party' }, [
    P('info', { Text: 'In play mode press 1, click the HUD button, or type "pac_event party" in chat.' }),
    P('text', { Bone: 'head', Position: [0, 16, 0], Text: 'press 1 in play mode', Size: 0.35, Color: [0.8, 0.9, 1] }, [
      P('event', { Event: 'command', Arguments: 'party', Invert: false }),
    ]),
  ])),

  'Speed trails': () => outfit(P('group', { Name: 'speed trails' }, [
    P('group', { Name: 'only while moving' }, [
      P('event', { Event: 'is_moving' }),
      ...['left foot', 'right foot', 'left hand', 'right hand'].map((b) => P('trail', { Bone: b, Duration: 0.45, StartSize: 3, StartColor: [0.4, 0.95, 1], EndColor: [0.1, 0.2, 1], Spacing: 1.5 })),
      P('text', { Bone: 'head', Position: [0, 15, 0], TextOverride: 'DynamicTextValue', Text: 'speed: ', RoundingPosition: 0, Size: 0.4, Color: [0.5, 1, 1] }, [
        P('proxy', { VariableName: 'DynamicTextValue', Expression: 'owner_velocity_length()' }),
      ]),
    ]),
    P('sound', { Name: 'footsteps', Bone: 'origin', Path: 'footstep', PlayOnFootstep: true, Overlapping: true, Volume: 0.6, MinPitch: 0, MaxPitch: 0.3 }),
    P('info', { Text: 'Press Play, then walk with WASD and sprint with Shift.' }),
  ])),

  'Pet orb & zap beam': () => outfit(P('group', { Name: 'pet' }, [
    P('jiggle', { Name: 'follow', Bone: 'chest', Position: [16, 16, -8], Strain: 0.85, Speed: 0.7 }, [
      P('model', { UniqueID: 'pet-body', Name: 'pet', Model: 'sphere', Size: 0.8, Color: [0.45, 0.75, 1], Roughness: 0.2, EyeAngles: true }, [
        P('material', { Emissive: [0.1, 0.3, 0.6], EmissiveIntensity: 1, Roughness: 0.15 }),
        P('proxy', { VariableName: 'Position', Axis: 'y', Expression: 'sin(time() * 2) * 2' }),
        P('model', { Model: 'sphere', Position: [1.2, 0.6, 2.9], Size: 0.12, Color: [0.05, 0.05, 0.08] }),
        P('model', { Model: 'sphere', Position: [-1.2, 0.6, 2.9], Size: 0.12, Color: [0.05, 0.05, 0.08] }),
        P('sprite', { Color: [0.4, 0.75, 1], Size: 18, Alpha: 0.35 }),
      ]),
    ]),
    P('beam', { Name: 'zap', Bone: 'right hand', Position: [0, -4, 0], Angles: [90, 0, 0], EndPoint: 'pet-body', Bend: 12, Width: 1.2, StartColor: [0.7, 0.9, 1], EndColor: [0.3, 0.6, 1], Jitter: 0.8 }, [
      P('event', { Event: 'is_firing' }),
      P('sound', { Path: 'laser', Volume: 0.5 }),
    ]),
    P('info', { Text: 'The pet looks where you look. Hold left mouse in play mode to zap it.' }),
  ])),

  'Blaster': () => outfit(P('group', { Name: 'blaster' }, [
    P('animation', { SequenceName: 'point', Weight: 0.85 }),
    P('model', { Name: 'gun', Bone: 'right hand', Model: 'cylinder', Position: [0, -4, 1], Angles: [90, 0, 0], Scale: [0.35, 0.35, 1.4], Color: [0.15, 0.16, 0.2], Metalness: 0.7, Roughness: 0.35 }, [
      P('model', { Model: 'torus', Position: [0, 0, 5.4], Size: 0.3, Color: [0.3, 1, 0.6], Material: 'glow' }),
    ]),
    P('model', { UniqueID: 'bolt', Name: 'bolt (template)', Hide: true, Model: 'capsule', Angles: [90, 0, 0], Size: 0.35, Color: [0.4, 1, 0.6], Material: 'glow' }, [
      P('trail', { Duration: 0.25, StartSize: 1.5, StartColor: [0.4, 1, 0.6], EndColor: [0.1, 0.6, 1], Spacing: 1 }),
    ]),
    P('group', { Name: 'firing' }, [
      P('event', { Event: 'is_firing' }),
      P('projectile', { Bone: 'right hand', Position: [0, -11, 1], EyeAngles: true, OutfitPart: 'bolt', Speed: 2, Gravity: false, FireRate: 0.15, LifeTime: 1.5, RemoveOnCollide: true }),
      P('sprite', { Name: 'muzzle flash', Bone: 'right hand', Position: [0, -11, 1], Color: [0.5, 1, 0.7], Size: 8 }, [
        P('proxy', { VariableName: 'Size', Expression: 'random(5, 12)' }),
      ]),
      P('sound', { Path: 'laser', Volume: 0.5 }),
    ]),
    P('info', { Text: 'Press Play, click to capture the mouse, then hold left mouse to fire.' }),
  ])),

  'Bobblehead giant': () => outfit(P('group', { Name: 'giant' }, [
    P('entity', { Size: 1.35, Color: [1, 0.85, 0.75] }),
    P('bone', { Bone: 'head', Size: 2 }, [
      P('proxy', { VariableName: 'Angles', Axis: 'z', Expression: 'sin(time() * 5) * 12' }),
    ]),
    P('model', { Name: 'hat', Bone: 'head', Model: 'cone', Position: [0, 11, 0], Size: 1.1, Color: [0.9, 0.2, 0.3] }, [
      P('model', { Model: 'sphere', Position: [0, 4.5, 0], Size: 0.3, Color: [1, 1, 1] }),
    ]),
    P('movement', { JumpHeight: 420, WalkSpeed: 180 }),
  ])),
};

export const DEFAULT_EXAMPLE = 'Angel wings & halo';
