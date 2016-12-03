// @flow
import { Viewer } from './viewer.js';
import { addXyzCross, makeLineMaterial, makeLineSegments } from './lines.js';
import * as THREE from 'three';


// options handled by Viewer#select_next()
const SPOT_SEL = ['all', 'unindexed', '#1']; //extended when needed
const SHOW_AXES = ['three', 'two', 'none'];

export function ReciprocalViewer(options /*: {[key: string]: any}*/) {
  Viewer.call(this, options);
  this.default_camera_pos = [100, 0, 0];
  this.axes = null;
  this.points = null;
  this.max_dist = null;
  this.d_min = null;
  this.d_max_inv = 0;
  this.data = null;
  this.config.show_only = SPOT_SEL[0];
  this.config.show_axes = SHOW_AXES[0];
  this.set_reciprocal_key_bindings();
  this.set_dropzone();
}

ReciprocalViewer.prototype = Object.create(Viewer.prototype);
ReciprocalViewer.prototype.constructor = ReciprocalViewer;

ReciprocalViewer.prototype.KEYBOARD_HELP = [
  '<b>keyboard:</b>',
  'H = toggle help',
  'V = show (un)indexed',
  'A = toggle axes',
  'B = bg color',
  'M/N = zoom',
  'D/F = clip width',
  'R = center view',
  'Z/X = point size',
  'Shift+P = permalink',
  'Shift+F = full screen',
  '←/→ = max resol.',
  '↑/↓ = min resol.',
].join('\n');

ReciprocalViewer.prototype.MOUSE_HELP = Viewer.prototype.MOUSE_HELP
                                        .split('\n').slice(0, -2).join('\n');

ReciprocalViewer.prototype.set_reciprocal_key_bindings = function () {
  let kb = this.key_bindings;
  // a
  kb[65] = function (evt) {
    this.select_next('axes', 'show_axes', SHOW_AXES, evt.shiftKey);
    this.set_axes();
  };
  // p
  kb[80] = function (evt) { this.permalink(); };
  // v
  kb[86] = function (evt) {
    this.select_next('show', 'show_only', SPOT_SEL, evt.shiftKey);
    const idx = SPOT_SEL.indexOf(this.config.show_only);
    this.points.material.uniforms.show_only.value = idx - 2;
  };
  // x
  kb[88] = function (evt) {
    evt.ctrlKey ? this.change_map_line(0.1) : this.change_point_size(0.5);
  };
  // z
  kb[90] = function (evt) {
    evt.ctrlKey ? this.change_map_line(-0.1) : this.change_point_size(-0.5);
  };
  // 3, numpad 3
  kb[51] = kb[99] = function () { this.shift_clip(0.1); };
  // numpad period (Linux), decimal point (Mac)
  kb[108] = kb[110] = function () { this.shift_clip(-0.1); };
  // <-
  kb[37] = function () { this.change_dmin(0.05); };
  // ->
  kb[39] = function () { this.change_dmin(-0.05); };
  // up arrow
  kb[38] = function () { this.change_dmax(0.025); };
  // down arrow
  kb[40] = function () { this.change_dmax(-0.025); };
};

ReciprocalViewer.prototype.set_dropzone = function () {
  if (typeof document === 'undefined') return;  // for testing on node
  const zone = this.renderer.domElement;
  const self = this;
  zone.addEventListener('dragover', function (e) {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    self.hud('ready for drop...');
  });
  zone.addEventListener('drop', function (e) {
    e.stopPropagation();
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file == null) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
      self.load_from_string(evt.target.result, {});
    };
    reader.readAsText(file);
    self.hud('loading ' + file.name);
  });
};

ReciprocalViewer.prototype.load_data = function (url, options = {}) {
  let self = this;
  this.load_file(url, {binary: false, progress: true}, function (req) {
    self.load_from_string(req.responseText, options);
    if (options.callback) options.callback();
  });
};

ReciprocalViewer.prototype.load_from_string = function (text, options) {
  if (text[0] === '{') {
    this.data = parse_json(text);
  } else {
    this.data = parse_csv(text);
  }
  this.max_dist = max_dist(this.data.pos);
  this.d_min = 1 / this.max_dist;
  const last_group = max_val(this.data.lattice_ids);
  console.log(last_group);
  SPOT_SEL.splice(3);
  for (let i = 1; i <= last_group; i++) {
    SPOT_SEL.push('#' + (i + 1));
  }
  this.set_axes();
  this.set_points();
  this.camera.zoom = 0.5 * (this.camera.top - this.camera.bottom);
  // default scale is set to 100 - same as default_camera_pos
  const d = 1.01 * this.max_dist;
  this.controls.slab_width = [d, d, 100];
  this.set_view(options);
};

function max_dist(pos) {
  let max_sq = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const n = 3 * i;
    const sq = pos[n]*pos[n] + pos[n+1]*pos[n+1] + pos[n+2]*pos[n+2];
    if (sq > max_sq) max_sq = sq;
  }
  return Math.sqrt(max_sq);
}

function max_val(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

function parse_csv(text) {
  const lines = text.split('\n').filter(function (line) {
    return line.length > 0 && line[0] !== '#';
  });
  let pos = new Float32Array(lines.length * 3);
  let lattice_ids = [];
  for (let i = 0; i < lines.length; i++) {
    const nums = lines[i].split(',').map(Number);
    for (let j = 0; j < 3; j++) {
      pos[3*i+j] = nums[j];
    }
    lattice_ids.push(nums[3]);
  }
  return { pos, lattice_ids };
}

function minus_ones(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(-1);
  return a;
}

function parse_json(text) {
  const d = JSON.parse(text);
  const n = d.rlp.length;
  let pos = new Float32Array(3*n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      pos[3*i+j] = d.rlp[i][j];
    }
  }
  const lattice_ids = d.experiment_id || minus_ones(n);
  return { pos, lattice_ids };
}

ReciprocalViewer.prototype.set_axes = function () {
  if (this.axes != null) {
    this.remove_and_dispose(this.axes);
    this.axes = null;
  }
  if (this.config.show_axes === 'none') return;
  const axis_length = 1.2 * this.max_dist;
  let vertices = [];
  addXyzCross(vertices, [0, 0, 0], axis_length);
  const ca = this.config.colors.axes;
  const colors = [ca[0], ca[0], ca[1], ca[1], ca[2], ca[2]];
  if (this.config.show_axes === 'two') {
    vertices.splice(4);
    colors.splice(4);
  }
  const material = makeLineMaterial({
    win_size: this.window_size,
    linewidth: 3,
    segments: true,
  });
  this.axes = makeLineSegments(material, vertices, colors);
  this.scene.add(this.axes);
};

const point_vert = [
  'attribute float group;',
  'uniform float show_only;',
  'uniform float r2_max;',
  'uniform float r2_min;',
  'uniform float size;',
  'varying vec3 vcolor;',
  'varying float vsel;',
  'void main() {',
  '  vcolor = color;',
  '  float throw_away = (show_only + 2.0) * (show_only - group);',
  '  float r2 = dot(position, position);',
  '  vsel = r2_min <= r2 && r2 < r2_max ? 1.0 : 0.0;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '  gl_Position.x += 2.0 * throw_away;',
  '  gl_PointSize = size;',
  '}'].join('\n');

const point_frag = [
  'varying vec3 vcolor;',
  'varying float vsel;',
  'void main() {',
  // not sure how reliable is such rounding of points
  '  vec2 diff = gl_PointCoord - vec2(0.5, 0.5);',
  '  float dist_sq = 4.0 * dot(diff, diff);',
  '  if (vsel == 0.0 || dist_sq >= 1.0) discard;',
  '  gl_FragColor = vec4(vcolor, 1.0 - dist_sq * dist_sq * dist_sq);',
  '}'].join('\n');


ReciprocalViewer.prototype.set_points = function () {
  if (this.data == null) return;
  if (this.points != null) {
    this.remove_and_dispose(this.points);
    this.points = null;
  }
  const pos = this.data.pos;
  const lattice_ids = this.data.lattice_ids;
  let color_arr = new Float32Array(3 * lattice_ids.length);
  this.colorize_by_id(color_arr, lattice_ids);
  let geometry = new THREE.BufferGeometry();
  geometry.addAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.addAttribute('color', new THREE.BufferAttribute(color_arr, 3));
  const groups = new Float32Array(lattice_ids);
  geometry.addAttribute('group', new THREE.BufferAttribute(groups, 1));
  let material = new THREE.ShaderMaterial({
    uniforms: {
      size: { value: 3 },
      show_only: { value: -2 },
      r2_max: { value: 100 },
      r2_min: { value: 0 },
    },
    vertexShader: point_vert,
    fragmentShader: point_frag,
    vertexColors: THREE.VertexColors,
  });
  material.transparent = true;
  this.points = new THREE.Points(geometry, material);
  this.scene.add(this.points);
  this.request_render();
};

ReciprocalViewer.prototype.colorize_by_id = function (color_arr, group_id) {
  const palette = this.config.colors.lattices;
  for (let i = 0; i < group_id.length; i++) {
    const c = palette[(group_id[i] + 1) % 4];
    color_arr[3*i] = c.r;
    color_arr[3*i+1] = c.g;
    color_arr[3*i+2] = c.b;
  }
};

ReciprocalViewer.prototype.redraw_center = function () {};

ReciprocalViewer.prototype.mousewheel_action = function (delta, evt) {
  this.change_zoom_by_factor(1 + 0.0005 * delta);
};

ReciprocalViewer.prototype.change_point_size = function (delta) {
  if (this.points === null) return;
  let size = this.points.material.uniforms.size;
  size.value = Math.max(size.value + delta, 0.5);
  this.hud('point size: ' + size.value.toFixed(1));
};

ReciprocalViewer.prototype.change_dmin = function (delta) {
  if (this.d_min == null) return;
  this.d_min = Math.max(this.d_min + delta, 0.1);
  const dmax = this.d_max_inv > 0 ? 1 / this.d_max_inv : null;
  if (dmax !== null && this.d_min > dmax) this.d_min = dmax;
  this.points.material.uniforms.r2_max.value = 1 / (this.d_min * this.d_min);
  const low_res = dmax !== null ? dmax.toFixed(2) : '∞';
  this.hud('res. limit: ' + low_res + ' - ' + this.d_min.toFixed(2) + 'Å');
};

ReciprocalViewer.prototype.change_dmax = function (delta) {
  if (this.d_min == null) return;
  let v = Math.min(this.d_max_inv + delta, 1 / this.d_min);
  if (v < 1e-6) v = 0;
  this.d_max_inv = v;
  this.points.material.uniforms.r2_min.value = v * v;
  const low_res = v > 0 ? (1 / v).toFixed(2) : '∞';
  this.hud('res. limit: ' + low_res + ' - ' + this.d_min.toFixed(2) + 'Å');
};

ReciprocalViewer.prototype.redraw_models = function () {
  if (this.points) this.remove_and_dispose(this.points);
  this.set_points();
};

ReciprocalViewer.prototype.ColorSchemes = [
  {
    name: 'solarized dark',
    bg: 0x002b36,
    fg: 0xfdf6e3,
    lattices: [0xdc322f, 0x2aa198, 0x268bd2, 0x859900,
               0xd33682, 0xb58900, 0x6c71c4, 0xcb4b16],
    axes: [0xffaaaa, 0xaaffaa, 0xaaaaff],
  },
  {
    name: 'solarized light',
    bg: 0xfdf6e3,
    fg: 0x002b36,
    lattices: [0xdc322f, 0x2aa198, 0x268bd2, 0x859900,
               0xd33682, 0xb58900, 0x6c71c4, 0xcb4b16],
    axes: [0xffaaaa, 0xaaffaa, 0xaaaaff],
  },
];
