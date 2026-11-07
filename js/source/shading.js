// Source engine material features (VertexLitGeneric / UnlitGeneric) on three.js materials, shared by
// game materials (.vmt) and material parts (PAC3 material_3d / material_2d):
//   detail textures with every $detailblendmode, $detailtexturetransform and animated $detailframe,
//   $selfillum with $selfillummask / $selfillumtint, phong ($phongboost, $phongexponent,
//   $phongalbedotint, $phongtint), $rimlight, $basetexturetransform / $bumptransform, $frame and
//   $bumpframe on animated textures, $color / $color2, $alpha, $additive, $translucent, $alphatest, $nocull.
import * as THREE from 'three';
import { getSourceTexture, textureFrame } from './assets.js';
import { parseVmtVector } from './keyvalues.js';
import { DEG } from '../core/util.js';

/**
 * Material part properties, named exactly like PAC3's material_3d (so outfits import as they are and
 * proxies can drive them), with PAC3's defaults. [name, type, default, extra]
 */
export const SHADER_PARAMS = [
  ['basetexture', 'asset', ''], ['frame', 'number', 0],
  ['basetexturetransformPosition', 'vector', [0, 0, 0]], ['basetexturetransformScale', 'vector', [1, 1, 1]], ['basetexturetransformAngle', 'number', 0], ['basetexturetransformAngleCenter', 'vector', [0.5, 0.5, 0]],
  ['bumpmap', 'asset', ''], ['bumpframe', 'number', 0],
  ['bumptransformPosition', 'vector', [0, 0, 0]], ['bumptransformScale', 'vector', [1, 1, 1]], ['bumptransformAngle', 'number', 0], ['bumptransformAngleCenter', 'vector', [0.5, 0.5, 0]],
  ['color', 'vector', [1, 1, 1]], ['color2', 'vector', [1, 1, 1]], ['alpha', 'number', 1],
  ['additive', 'boolean', false], ['translucent', 'boolean', false], ['alphatest', 'boolean', false], ['alphatestreference', 'number', 0.7],
  ['nocull', 'boolean', false], ['halflambert', 'boolean', false], ['vertexcolor', 'boolean', false], ['vertexalpha', 'boolean', false],
  ['model', 'boolean', false], ['ignorez', 'boolean', false], ['wireframe', 'boolean', false], ['nofog', 'boolean', false],
  ['phong', 'boolean', false], ['phongboost', 'number', 1], ['phongexponent', 'number', 5], ['phongexponenttexture', 'asset', ''],
  ['phongfresnelranges', 'vector', [0.05, 0.5, 1]], ['phongalbedotint', 'boolean', false], ['phongtint', 'vector', [1, 1, 1]],
  ['phongwarptexture', 'asset', ''], ['basemapalphaphongmask', 'boolean', false], ['invertphongmask', 'boolean', false],
  ['rimlight', 'boolean', false], ['rimlightboost', 'number', 0], ['rimlightexponent', 'number', 0], ['rimmask', 'boolean', false],
  ['selfillum', 'boolean', false], ['selfillummask', 'asset', ''], ['selfillumtint', 'vector', [1, 1, 1]],
  ['selfillumfresnel', 'boolean', false], ['selfillumfresnelminmaxexp', 'vector', [0, 1, 1]],
  ['detail', 'asset', ''], ['detailscale', 'number', 1], ['detailframe', 'number', 0], ['detailblendmode', 'number', 0], ['detailblendfactor', 'number', 1], ['detailtint', 'vector', [1, 1, 1]],
  ['detailtexturetransformPosition', 'vector', [0, 0, 0]], ['detailtexturetransformScale', 'vector', [1, 1, 1]], ['detailtexturetransformAngle', 'number', 0], ['detailtexturetransformAngleCenter', 'vector', [0.5, 0.5, 0]],
  ['envmap', 'asset', ''], ['envmaptint', 'vector', [1, 1, 1]], ['envmapmask', 'asset', ''], ['envmapcontrast', 'number', 0], ['envmapsaturation', 'vector', [1, 1, 1]],
  ['basealphaenvmapmask', 'boolean', false], ['normalmapalphaenvmapmask', 'boolean', false], ['envmapframe', 'number', 0],
  ['lightwarptexture', 'asset', ''],
];
/** Shaders a material part can use; '' keeps the simpler PAC3 Web material settings. */
export const SHADERS = ['', 'VertexLitGeneric', 'UnlitGeneric', 'Refract', 'EyeRefract'];

// Source's own defaults where they differ from PAC3's (used for .vmt files)
const VMT_DEFAULTS = { detailscale: 4, alphatestreference: 0.5, rimlightboost: 1, rimlightexponent: 4 };

const I3 = new THREE.Matrix3();

/** PAC3 texture transform (Position / Scale / Angle in turns / AngleCenter), times an extra uniform scale. */
function partMatrix(pos, scale, turns, center, extra = 1) {
  const a = (Number(turns) || 0) * 360 * DEG, c = Math.cos(a), s = Math.sin(a);
  const cx = center[0], cy = center[1];
  // translate(pos) * translate(center) * rotate * translate(-center), then the axes scaled (VMatrix:SetScale)
  const tx = pos[0] + cx - (c * cx - s * cy), ty = pos[1] + cy - (s * cx + c * cy);
  return new THREE.Matrix3().set(scale[0] * c * extra, -scale[1] * s * extra, tx * extra, scale[0] * s * extra, scale[1] * c * extra, ty * extra, 0, 0, 1);
}
/** .vmt texture transform string: "center .5 .5 scale 1 1 rotate 0 translate 0 0". */
function vmtMatrix(str, extra = 1) {
  const t = String(str).toLowerCase().replace(/[[\]]/g, ' ').trim().split(/\s+/);
  let center = [0.5, 0.5], scale = [1, 1], rot = 0, tr = [0, 0];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'center') { center = [+t[i + 1] || 0, +t[i + 2] || 0]; i += 2; }
    else if (t[i] === 'scale') { scale = [+t[i + 1] || 0, +t[i + 2] || 0]; i += 2; }
    else if (t[i] === 'rotate') { rot = +t[i + 1] || 0; i += 1; }
    else if (t[i] === 'translate') { tr = [+t[i + 1] || 0, +t[i + 2] || 0]; i += 2; }
  }
  const a = rot * DEG, c = Math.cos(a), s = Math.sin(a);
  // uv' = R * S * (uv - center) + center + translate
  const m00 = c * scale[0], m01 = -s * scale[1], m10 = s * scale[0], m11 = c * scale[1];
  const tx = center[0] + tr[0] - (m00 * center[0] + m01 * center[1]), ty = center[1] + tr[1] - (m10 * center[0] + m11 * center[1]);
  return new THREE.Matrix3().set(m00 * extra, m01 * extra, tx * extra, m10 * extra, m11 * extra, ty * extra, 0, 0, 1);
}

/**
 * Normalized shading settings from shader parameters.
 * get(name): value by lowercase name without "$" (a .vmt string, or a material part's number/array/bool).
 * vmt: true for .vmt files (Source defaults and transform strings), false for material parts.
 */
export function sourceParams(get, { shader = 'vertexlitgeneric', vmt = false } = {}) {
  const raw = (k) => { const v = get(k); return v === undefined && vmt ? VMT_DEFAULTS[k] : v; };
  const num = (k, d) => { const v = raw(k); const x = typeof v === 'boolean' ? Number(v) : Number(v); return v == null || v === '' || !Number.isFinite(x) ? d : x; };
  const on = (k) => { const v = raw(k); return v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false'); };
  const vec = (k, d) => { const v = raw(k); if (Array.isArray(v)) return v.slice(0, 3).map(Number); const p = typeof v === 'string' ? parseVmtVector(v) : typeof v === 'number' ? [v, v, v] : null; return p || d; };
  const tex = (k, opts) => { const v = raw(k); return typeof v === 'string' && v.trim() && !/^env_cubemap$/i.test(v.trim()) ? getSourceTexture(v.trim(), opts) : null; };
  const matrix = (k, extra = 1) => {
    if (vmt) { const v = raw(k); return v ? vmtMatrix(v, extra) : extra !== 1 ? new THREE.Matrix3().set(extra, 0, 0, 0, extra, 0, 0, 0, 1) : I3; }
    return partMatrix(vec(`${k}Position`, [0, 0, 0]), vec(`${k}Scale`, [1, 1, 1]), num(`${k}Angle`, 0), vec(`${k}AngleCenter`, [0.5, 0.5, 0]), extra);
  };
  const c1 = vec('color', [1, 1, 1]), c2 = vec('color2', [1, 1, 1]);
  const sh = String(shader).toLowerCase();
  return {
    shader: sh,
    unlit: sh === 'unlitgeneric',
    base: tex('basetexture'), baseFrame: num('frame', 0), baseMat: matrix('basetexturetransform'),
    bump: tex('bumpmap', { linear: true }) || tex('normalmap', { linear: true }), bumpFrame: num('bumpframe', 0), bumpMat: matrix('bumptransform'),
    color: [c1[0] * c2[0], c1[1] * c2[1], c1[2] * c2[2]],
    alpha: num('alpha', 1),
    additive: on('additive'), translucent: on('translucent') || on('vertexalpha'),
    alphatest: on('alphatest'), alphatestref: num('alphatestreference', 0.7),
    nocull: on('nocull'), ignorez: on('ignorez'), wireframe: on('wireframe'),
    phong: on('phong'), phongboost: num('phongboost', 1), phongexponent: num('phongexponent', 5), phongalbedotint: on('phongalbedotint'), phongtint: vec('phongtint', [1, 1, 1]),
    rimlight: on('rimlight'), rimboost: num('rimlightboost', 0),
    selfillum: on('selfillum'), selfillummask: tex('selfillummask', { linear: true }), selfillumtint: vec('selfillumtint', [1, 1, 1]),
    detail: tex('detail'), detailFrame: num('detailframe', 0), detailMat: matrix('detailtexturetransform', num('detailscale', 1)),
    detailmode: Math.round(num('detailblendmode', 0)), detailfactor: num('detailblendfactor', 1), detailtint: vec('detailtint', [1, 1, 1]),
    envmap: !!raw('envmap'), envmaptint: vec('envmaptint', [1, 1, 1]),
  };
}

/** Roughness that gives a highlight about the size of a Source phong exponent. */
export const phongRoughness = (exp) => Math.min(0.95, Math.max(0.08, Math.sqrt(2 / (Math.max(0, exp) + 2))));

const DECL_V = 'varying vec2 vSrcUv;\nuniform mat3 uSrcBaseMat;\nuniform mat3 uSrcBumpMat;\n';
const UV_V = `#include <uv_vertex>
vSrcUv = uv;
#ifdef USE_MAP
vMapUv = ( uSrcBaseMat * vec3( vMapUv, 1.0 ) ).xy;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = ( uSrcBumpMat * vec3( vNormalMapUv, 1.0 ) ).xy;
#endif`;
const DECL_F = `varying vec2 vSrcUv;
uniform bool uSrcHasDetail; uniform sampler2D uSrcDetail; uniform mat3 uSrcDetailMat; uniform int uSrcDetailMode; uniform float uSrcDetailFactor; uniform vec3 uSrcDetailTint;
uniform bool uSrcSelfIllum; uniform bool uSrcHasMask; uniform sampler2D uSrcMask; uniform vec3 uSrcSelfIllumTint;
uniform vec3 uSrcSpec; uniform float uSrcPhongAlbedo; uniform float uSrcRim;
`;
// detail blend modes applied to the albedo (before lighting); 5 and 6 add light afterwards
const DETAIL_F = `#include <map_fragment>
float srcBaseAlpha = diffuseColor.a;
vec4 srcDetail = vec4( 0.0 );
if ( uSrcHasDetail ) {
  srcDetail = texture2D( uSrcDetail, ( uSrcDetailMat * vec3( vSrcUv, 1.0 ) ).xy );
  srcDetail.rgb *= uSrcDetailTint;
  float f = uSrcDetailFactor;
  if ( uSrcDetailMode == 1 ) diffuseColor.rgb += srcDetail.rgb * f;
  else if ( uSrcDetailMode == 2 ) diffuseColor.rgb = mix( diffuseColor.rgb, srcDetail.rgb, srcDetail.a * f );
  else if ( uSrcDetailMode == 3 ) diffuseColor.rgb = mix( diffuseColor.rgb, srcDetail.rgb, f );
  else if ( uSrcDetailMode == 4 ) diffuseColor.rgb = mix( srcDetail.rgb, diffuseColor.rgb, srcBaseAlpha );
  else if ( uSrcDetailMode == 8 ) diffuseColor.rgb *= mix( vec3( 1.0 ), srcDetail.rgb, f );
  else if ( uSrcDetailMode == 9 ) diffuseColor.a *= mix( 1.0, srcDetail.a, f );
  else if ( uSrcDetailMode != 5 && uSrcDetailMode != 6 ) {
    // mod2x works on gamma values: mid grey leaves the base unchanged
    vec3 g = pow( max( srcDetail.rgb, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) ) * 2.0;
    diffuseColor.rgb *= mix( vec3( 1.0 ), pow( g, vec3( 2.2 ) ), f );
  }
}`;
const POST = (base) => `${base}
if ( uSrcHasDetail && uSrcDetailMode == 5 ) outgoingLight += srcDetail.rgb * uSrcDetailFactor;
if ( uSrcHasDetail && uSrcDetailMode == 6 ) outgoingLight += srcDetail.rgb * clamp( ( srcDetail.a - ( 1.0 - uSrcDetailFactor ) ) * 4.0, 0.0, 1.0 );`;
const LIT_F = `totalSpecular *= uSrcSpec * mix( vec3( 1.0 ), diffuseColor.rgb, uSrcPhongAlbedo );
if ( uSrcRim > 0.0 ) totalSpecular += pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 4.0 ) * uSrcRim * 0.25;
if ( uSrcSelfIllum ) {
  vec3 srcMask = uSrcHasMask ? texture2D( uSrcMask, vSrcUv ).rgb : vec3( srcBaseAlpha );
  totalDiffuse = mix( totalDiffuse, diffuseColor.rgb * uSrcSelfIllumTint, srcMask );
}
${POST('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')}`;

function hook(m) {
  if (m.userData.srcUniforms) return m.userData.srcUniforms;
  const u = {
    uSrcBaseMat: { value: new THREE.Matrix3() }, uSrcBumpMat: { value: new THREE.Matrix3() },
    uSrcHasDetail: { value: false }, uSrcDetail: { value: null }, uSrcDetailMat: { value: new THREE.Matrix3() }, uSrcDetailMode: { value: 0 }, uSrcDetailFactor: { value: 1 }, uSrcDetailTint: { value: new THREE.Vector3(1, 1, 1) },
    uSrcSelfIllum: { value: false }, uSrcHasMask: { value: false }, uSrcMask: { value: null }, uSrcSelfIllumTint: { value: new THREE.Vector3(1, 1, 1) },
    uSrcSpec: { value: new THREE.Vector3(1, 1, 1) }, uSrcPhongAlbedo: { value: 0 }, uSrcRim: { value: 0 },
  };
  m.userData.srcUniforms = u;
  const lit = m.isMeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${DECL_V}`).replace('#include <uv_vertex>', UV_V);
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${DECL_F}`).replace('#include <map_fragment>', DETAIL_F);
    f = lit
      ? f.replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', LIT_F)
      : f.replace('vec3 outgoingLight = reflectedLight.indirectDiffuse;', POST('vec3 outgoingLight = reflectedLight.indirectDiffuse;'));
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => (lit ? 'src-lit-1' : 'src-unlit-1');
  m.needsUpdate = true;
  return u;
}

/**
 * Applies the Source-only parts of a material: detail layer, self-illumination, phong, rim light and
 * texture transforms. The caller sets map, normal map, color, opacity and blending (see SourceMaterial users).
 */
export function applySourceShading(m, P) {
  const u = hook(m);
  u.uSrcBaseMat.value.copy(P.baseMat);
  u.uSrcBumpMat.value.copy(P.bumpMat);
  const detail = P.detail ? textureFrame(P.detail, P.detailFrame) : null;
  u.uSrcHasDetail.value = !!detail && !detail.userData.failed;
  u.uSrcDetail.value = detail;
  u.uSrcDetailMat.value.copy(P.detailMat);
  u.uSrcDetailMode.value = P.detailmode;
  u.uSrcDetailFactor.value = P.detailfactor;
  u.uSrcDetailTint.value.fromArray(P.detailtint);
  u.uSrcSelfIllum.value = !!P.selfillum;
  u.uSrcHasMask.value = !!P.selfillummask && !P.selfillummask.userData.failed;
  u.uSrcMask.value = P.selfillummask;
  u.uSrcSelfIllumTint.value.fromArray(P.selfillumtint);
  // no phong: no highlights (Source's VertexLitGeneric has none); an env map keeps some reflection
  const spec = P.phong ? P.phongboost * 0.6 : P.envmap ? 0.35 : 0;
  u.uSrcSpec.value.set(spec * P.phongtint[0], spec * P.phongtint[1], spec * P.phongtint[2]);
  if (P.envmap && !P.phong) u.uSrcSpec.value.multiply(new THREE.Vector3().fromArray(P.envmaptint));
  u.uSrcPhongAlbedo.value = P.phong && P.phongalbedotint ? 1 : 0;
  u.uSrcRim.value = P.rimlight ? P.rimboost : 0;
  if (m.isMeshStandardMaterial) {
    m.roughness = P.phong ? phongRoughness(P.phongexponent) : P.envmap ? 0.25 : 0.85;
    m.metalness = 0;
    m.emissive.setRGB(0, 0, 0);
    m.emissiveMap = null;
  }
  return detail;
}
/** Marks a material as plain three.js again. */
export function clearSourceShading(m) {
  if (!m.userData.srcUniforms) return;
  delete m.userData.srcUniforms;
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => '';
  m.needsUpdate = true;
}
