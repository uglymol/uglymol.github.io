
var THREE = THREE || require('three'); // eslint-disable-line
var LineFactory = LineFactory || require('./lines'); // eslint-disable-line
var ElMap = ElMap || require('./elmap'); // eslint-disable-line
var Model = Model || require('./model'); // eslint-disable-line

var Viewer = (function () {
'use strict';

var use_gl_lines = false;

var ColorSchemes = { // accessible as Viewer.ColorSchemes
  dark: {
    bg: 0x000000,
    map_den: 0x3362B2,
    map_pos: 0x298029,
    map_neg: 0x8B2E2E,
    center: 0xC997B0,
    cell_box: 0xFFFFFF,
    // atoms
    H: 0x858585, // H is normally invisible
    // C, N and O are taken approximately (by color-picker) from coot
    C: 0xb3b300,
    N: 0x7EAAFB,
    O: 0xF24984,
    S: 0x40ff40, // S in coot is too similar to C, here it is greener
    // Coot doesn't define other colors (?)
    MG: 0xc0c0c0,
    P: 0xffc040,
    CL: 0xa0ff60,
    CA: 0xffffff,
    MN: 0xff90c0,
    FE: 0xa03000,
    NI: 0x00ff80,
    def: 0xa0a0a0 // default atom color
  },
  light: { // like in Coot after Edit > Background Color > White
    bg: 0xFFFFFF,
    map_den: 0x3362B2,
    map_pos: 0x298029,
    map_neg: 0x8B2E2E,
    center: 0xC7C769,
    cell_box: 0x000000,
    H: 0x999999,
    C: 0xA96464,
    N: 0x1C51B3,
    O: 0xC33869,
    S: 0x9E7B3D,
    def: 0x808080
  }
};

var auto_speed = 1.0;  // accessible as Viewer.auto_speed

// relative position on canvas in normalized device coordinates [-1, +1]
function relX(evt) { return 2 * evt.pageX / window.innerWidth - 1; }
function relY(evt) { return 1 - 2 * evt.pageY / window.innerHeight; }

// map 2d position to sphere with radius 1.
function project_on_ball(x, y) {
  var z = 0;
  var length_sq = x * x + y * y;
  if (length_sq < 1) {  // in ellipse
    z = Math.sqrt(1.0 - length_sq);
  } else {  // in a corner
    var length = Math.sqrt(length_sq);
    x /= length;
    y /= length;
  }
  return [x, y, z];  // guaranteed to be normalized
}

var _raycaster;
function get_raycaster(coords, camera) {
  if (_raycaster === undefined) _raycaster = new THREE.Raycaster();
  _raycaster.setFromCamera(coords, camera);
  _raycaster.near = camera.near;
  _raycaster.far = camera.far - 0.2 * (camera.far - camera.near); // 20% in fog
  _raycaster.linePrecision = 0.2;
  return _raycaster;
}

var STATE = {NONE: -1, ROTATE: 0, PAN: 1, ZOOM: 2, PAN_ZOOM: 3, SLAB: 4,
             ROLL: 5, AUTO_ROTATE: 6, GO: 7};


// based on three.js/examples/js/controls/OrthographicTrackballControls.js
var Controls = function (camera, target) {
  var _state = STATE.NONE;
  var _rotate_start = new THREE.Vector3();
  var _rotate_end = new THREE.Vector3();
  var _zoom_start = new THREE.Vector2();
  var _zoom_end = new THREE.Vector2();
  var _pinch_start = 0;
  var _pinch_end = 0;
  var _pan_start = new THREE.Vector2();
  var _pan_end = new THREE.Vector2();
  var _panned = true;
  var _slab_width = 10.0;
  var _rock_state = 0.0;
  var _auto_stamp = null;
  var _go_func = null;

  function change_slab_width(delta) {
    _slab_width = Math.max(_slab_width + delta, 0.01);
  }

  function rotate_camera(eye) {
    var quat = new THREE.Quaternion();
    quat.setFromUnitVectors(_rotate_end, _rotate_start);
    eye.applyQuaternion(quat);
    camera.up.applyQuaternion(quat);
    _rotate_end.applyQuaternion(quat);
    _rotate_start.copy(_rotate_end);
  }

  function zoom_camera(eye) {
    var dx = _zoom_end.x - _zoom_start.x;
    var dy = _zoom_end.y - _zoom_start.y;
    if (_state === STATE.ZOOM) {
      camera.zoom /= (1 - dx + dy);
    } else if (_state === STATE.SLAB) {
      change_slab_width(10.0 * dx);
      target.addScaledVector(eye, -5.0 / eye.length() * dy);
    } else if (_state === STATE.ROLL) {
      camera.up.applyAxisAngle(eye, 0.05 * (dx - dy));
    }
    _zoom_start.copy(_zoom_end);
  }

  function pan_camera(eye) {
    var dx = _pan_end.x - _pan_start.x;
    var dy = _pan_end.y - _pan_start.y;
    dx *= 0.5 * (camera.right - camera.left) / camera.zoom;
    dy *= 0.5 * (camera.bottom - camera.top) / camera.zoom;
    var pan = eye.clone().cross(camera.up).setLength(dx);
    pan.addScaledVector(camera.up, dy / camera.up.length());
    camera.position.add(pan);
    target.add(pan);
    _pan_start.copy(_pan_end);
  }

  this.toggle_auto = function (params) {
    _state = (_state === STATE.AUTO_ROTATE ? STATE.NONE : STATE.AUTO_ROTATE);
    _auto_stamp = null;
    _rock_state = params.rock ? 0.0 : null;
  };

  this.is_going = function () { return _state === STATE.GO; };

  this.is_moving = function () {
    return _state !== STATE.NONE;
  };

  function auto_rotate(eye) {
    _rotate_start.copy(eye).normalize();
    var now = Date.now();
    var elapsed = (_auto_stamp !== null ? now - _auto_stamp : 16.7);
    var speed = 1.8e-5 * elapsed * auto_speed;
    _auto_stamp = now;
    if (_rock_state !== null) {
      _rock_state += 0.02;
      speed = 4e-5 * auto_speed * Math.cos(_rock_state);
    }
    _rotate_end.crossVectors(camera.up, eye).multiplyScalar(speed)
      .add(_rotate_start);
  }

  this.update = function () {
    var changed = false;
    var eye = camera.position.clone().sub(target);
    if (_state === STATE.AUTO_ROTATE) {
      auto_rotate(eye);
    }
    if (!_rotate_start.equals(_rotate_end)) {
      rotate_camera(eye);
      changed = true;
    }
    if (_pinch_end !== _pinch_start) {
      camera.zoom *= _pinch_end / _pinch_start;
      _pinch_start = _pinch_end;
      changed = true;
    }
    if (!_zoom_end.equals(_zoom_start)) {
      zoom_camera(eye);
      changed = true;
    }
    if (!_pan_end.equals(_pan_start)) {
      pan_camera(eye);
      _panned = true;
      changed = true;
    }
    camera.position.addVectors(target, eye);
    if (_state === STATE.GO) {
      _go_func();
      changed = true;
    }
    camera.lookAt(target);
    return changed;
  };

  this.start = function (new_state, x, y, dist) {
    if (_state === STATE.NONE || _state === STATE.AUTO_ROTATE) {
      _state = new_state;
    }
    this.move(x, y, dist);
    switch (_state) {
      case STATE.ROTATE:
        _rotate_start.copy(_rotate_end);
        break;
      case STATE.ZOOM:
      case STATE.SLAB:
      case STATE.ROLL:
        _zoom_start.copy(_zoom_end);
        break;
      case STATE.PAN:
        _pan_start.copy(_pan_end);
        _panned = false;
        break;
      case STATE.PAN_ZOOM:
        _pinch_start = _pinch_end;
        _pan_start.copy(_pan_end);
        break;
    }
  };

  this.move = function (x, y, dist) {
    switch (_state) {
      case STATE.ROTATE:
        var xyz = project_on_ball(x, y);
        //console.log(this.camera.projectionMatrix);
        //console.log(this.camera.matrixWorld);
        // TODO maybe use project()/unproject()/applyProjection()
        var eye = camera.position.clone().sub(target);
        _rotate_end.crossVectors(camera.up, eye).setLength(xyz[0]);
        _rotate_end.addScaledVector(camera.up, xyz[1] / camera.up.length());
        _rotate_end.addScaledVector(eye, xyz[2] / eye.length());
        break;
      case STATE.ZOOM:
      case STATE.SLAB:
      case STATE.ROLL:
        _zoom_end.set(x, y);
        break;
      case STATE.PAN:
        _pan_end.set(x, y);
        break;
      case STATE.PAN_ZOOM:
        _pan_end.set(x, y);
        _pinch_end = dist;
        break;
    }
  };

  this.stop = function (model_bag) {
    var atom = null;
    if (_state === STATE.PAN && !_panned && model_bag) {
      atom = model_bag.pick_atom(get_raycaster(_pan_start, camera));
    }
    _state = STATE.NONE;
    _rotate_start.copy(_rotate_end);
    _pinch_start = _pinch_end;
    _pan_start.copy(_pan_end);
    if (atom !== null) { // center on atom
      this.go_to(new THREE.Vector3(atom.xyz[0], atom.xyz[1], atom.xyz[2]));
    }
  };

  this.slab_width = function () { return _slab_width; };
  this.change_slab_width = change_slab_width;

  this.go_to = function (targ, cam_pos, cam_up, steps) {
    if ((!targ || targ.distanceToSquared(target) < 0.1) &&
        (!cam_pos || cam_pos.distanceToSquared(camera.position) < 0.1) &&
        (!cam_up || cam_up.distanceToSquared(camera.up) < 0.1)) {
      return;
    }
    _state = STATE.GO;
    steps = steps || (60 / auto_speed);
    var alphas = [];
    var prev_pos = 0;
    for (var i = 1; i <= steps; ++i) {
      var pos = i / steps;
      // quadratic easing
      pos = pos < 0.5 ? 2 * pos * pos : -2 * pos * (pos-2) - 1;
      alphas.push((pos - prev_pos) / (1 - prev_pos));
      prev_pos = pos;
    }
    _go_func = function () {
      var a = alphas.shift();
      if (targ) {
        // unspecified cam_pos - camera stays in the same distance to target
        if (!cam_pos) camera.position.sub(target);
        target.lerp(targ, a);
        if (!cam_pos) camera.position.add(target);
      }
      if (cam_pos) camera.position.lerp(cam_pos, a);
      if (cam_up) camera.up.lerp(cam_up, a);
      if (alphas.length === 0) {
        _state = STATE.NONE;
        _go_func = null;
      }
    };
  };
};


// constants

var CUBE_EDGES = [[0, 0, 0], [1, 0, 0],
                  [0, 0, 0], [0, 1, 0],
                  [0, 0, 0], [0, 0, 1],
                  [1, 0, 0], [1, 1, 0],
                  [1, 0, 0], [1, 0, 1],
                  [0, 1, 0], [1, 1, 0],
                  [0, 1, 0], [0, 1, 1],
                  [0, 0, 1], [1, 0, 1],
                  [0, 0, 1], [0, 1, 1],
                  [1, 0, 1], [1, 1, 1],
                  [1, 1, 0], [1, 1, 1],
                  [0, 1, 1], [1, 1, 1]];

var COLOR_AIMS = ['element', 'B-factor', 'occupancy', 'index', 'chain'];
var RENDER_STYLES = ['lines', 'trace', 'ribbon'/*, 'ball&stick'*/];
var MAP_STYLES = ['marching cubes', 'snapped MC'];

function make_center_cube(size, ctr, color) {
  var geometry = new THREE.Geometry();
  for (var i = 0; i < CUBE_EDGES.length; i++) {
    var a = CUBE_EDGES[i];
    var x = ctr.x + size * (a[0] - 0.5);
    var y = ctr.y + size * (a[1] - 0.5);
    var z = ctr.z + size * (a[2] - 0.5);
    geometry.vertices.push(new THREE.Vector3(x, y, z));
  }
  var material = new THREE.LineBasicMaterial({color: color, linewidth: 2});
  return new THREE.LineSegments(geometry, material);
}

function make_unitcell_box(uc, color) {
  if (!uc) {
    throw Error('Unit cell not defined!');
  }
  var geometry = new THREE.Geometry();
  for (var i = 0; i < CUBE_EDGES.length; i++) {
    var xyz = uc.orthogonalize(CUBE_EDGES[i]);
    geometry.vertices.push(new THREE.Vector3(xyz[0], xyz[1], xyz[2]));
  }
  geometry.colors.push(
    new THREE.Color(0xff0000), new THREE.Color(0xffaa00),
    new THREE.Color(0x00ff00), new THREE.Color(0xaaff00),
    new THREE.Color(0x0000ff), new THREE.Color(0x00aaff)
  );
  for (var j = 6; j < CUBE_EDGES.length; j++) {
    geometry.colors.push(color);
  }
  var material = new THREE.LineBasicMaterial({vertexColors:
                                                THREE.VertexColors});
  return new THREE.LineSegments(geometry, material);
}

function rainbow_value(v, vmin, vmax) {
  var c = new THREE.Color(0xe0e0e0);
  if (vmin < vmax) {
    var ratio = (v - vmin) / (vmax - vmin);
    var hue = (240 - (240 * ratio)) / 360;
    c.setHSL(hue, 1.0, 0.5);
  }
  return c;
}

function color_by(style, atoms, elem_colors) {
  var color_func;
  var i;
  var last_atom = atoms[atoms.length-1];
  if (style === 'index') {
    color_func = function (atom) {
      return rainbow_value(atom.i_seq, 0, last_atom.i_seq);
    };
  } else if (style === 'B-factor') {
    var vmin = Infinity;
    var vmax = -Infinity;
    for (i = 0; i < atoms.length; i++) {
      var v = atoms[i].b;
      if (v > vmax) vmax = v;
      if (v < vmin) vmin = v;
    }
    //console.log('B-factors in [' + vmin + ', ' + vmax + ']');
    color_func = function (atom) {
      return rainbow_value(atom.b, vmin, vmax);
    };
  } else if (style === 'occupancy') {
    color_func = function (atom) {
      return rainbow_value(atom.occ, 0, 1);
    };
  } else if (style === 'chain') {
    color_func = function (atom) {
      return rainbow_value(atom.chain_index, 0, last_atom.chain_index);
    };
  } else { // element
    color_func = function (atom) {
      return elem_colors[atom.element] || elem_colors.def;
    };
  }
  var colors = [];
  for (i = 0; i < atoms.length; i++) {
    colors.push(color_func(atoms[i]));
  }
  return colors;
}

// Add a representation of an unbonded atom as a cross to geometry
function add_isolated_atom(geometry, atom, color) {
  var c = atom.xyz;
  var R = 0.7;
  geometry.vertices.push(new THREE.Vector3(c[0]-R, c[1], c[2]));
  geometry.vertices.push(new THREE.Vector3(c[0]+R, c[1], c[2]));
  geometry.vertices.push(new THREE.Vector3(c[0], c[1]-R, c[2]));
  geometry.vertices.push(new THREE.Vector3(c[0], c[1]+R, c[2]));
  geometry.vertices.push(new THREE.Vector3(c[0], c[1], c[2]-R));
  geometry.vertices.push(new THREE.Vector3(c[0], c[1], c[2]+R));
  for (var i = 0; i < 6; i++) {
    geometry.colors.push(color);
  }
}

function set_colors(palette, o) {
  var scheme = ColorSchemes[palette];
  for (var key in scheme) {
    if (o[key]) {
      o[key].set(scheme[key]);
    } else {
      o[key] = new THREE.Color(scheme[key]);
    }
  }
  o.name = palette;
  return o;
}


function MapBag(map, is_diff_map) {
  this.map = map;
  this.name = '';
  this.isolevel = is_diff_map ? 3.0 : 1.5;
  this.visible = true;
  this.types = is_diff_map ? ['map_pos', 'map_neg'] : ['map_den'];
  this.block_ctr = new THREE.Vector3(Infinity, 0, 0);
  this.el_objects = []; // three.js objects
}


function ModelBag(model, config) {
  this.model = model;
  this.name = '';
  this.visible = true;
  this.conf = config;
  this.atomic_objects = null; // list of three.js objects
}

ModelBag.prototype.pick_atom = function (raycaster) {
  var intersects = raycaster.intersectObjects(this.atomic_objects);
  if (intersects.length < 1) return null;
  var p = intersects[0].point;
  return this.model.get_nearest_atom(p.x, p.y, p.z);
};

ModelBag.prototype.get_visible_atoms = function () {
  var atoms = this.model.atoms;
  if (this.conf.hydrogens || !this.model.has_hydrogens) {
    return atoms;
  }
  var non_h = [];
  for (var i = 0; i < atoms.length; i++) {
    if (atoms[i].element !== 'H') {
      non_h.push(atoms[i]);
    }
  }
  return non_h;
};

ModelBag.prototype.add_bonds = function (ligands_only, ball_size) {
  var visible_atoms = this.get_visible_atoms();
  var color_style = ligands_only ? 'element' : this.conf.color_aim;
  var colors = color_by(color_style, visible_atoms, this.conf.colors);
  var geometry = new THREE.Geometry();
  var opt = { hydrogens: this.conf.hydrogens,
              ligands_only: ligands_only,
              balls: this.conf.render_style === 'ball&stick' };
  var linewidth = get_line_width(this.conf);
  for (var i = 0; i < visible_atoms.length; i++) {
    var atom = visible_atoms[i];
    var color = colors[i];
    if (ligands_only && !atom.is_ligand) continue;
    if (atom.bonds.length === 0 && !opt.balls) { // nonbonded, draw star
      add_isolated_atom(geometry, atom, color);
    } else { // bonded, draw lines
      for (var j = 0; j < atom.bonds.length; j++) {
        // TODO: one line per bond (with two colors per vertex)?
        var other = this.model.atoms[atom.bonds[j]];
        if (!opt.hydrogens && other.element === 'H') continue;
        // Coot show X-H bonds as thinner lines in a single color.
        // Here we keep it simple and render such bonds like all others.
        if (opt.ligands_only && !other.is_ligand) continue;
        var mid = atom.midpoint(other);
        var vmid = new THREE.Vector3(mid[0], mid[1], mid[2]);
        var vatom = new THREE.Vector3(atom.xyz[0], atom.xyz[1], atom.xyz[2]);
        if (opt.balls) {
          var lerp_factor = vatom.distanceTo(vmid) / ball_size;
          //color = this.conf.colors.def; // for debugging only
          vatom.lerp(vmid, lerp_factor);
        }
        geometry.vertices.push(vatom, vmid);
        geometry.colors.push(color, color);
      }
    }
  }
  var line_factory = new LineFactory(use_gl_lines, {
    linewidth: linewidth,
    size: this.conf.window_size
  }, true);
  //console.log('make_bonds() vertex count: ' + geometry.vertices.length);
  this.atomic_objects.push(line_factory.make_line_segments(geometry));
  if (opt.balls) {
    this.atomic_objects.push(line_factory.make_balls(visible_atoms, colors,
                                                     ball_size));
  } else if (!use_gl_lines && !ligands_only) {
    this.atomic_objects.push(line_factory.make_caps(visible_atoms, colors));
  }
};

ModelBag.prototype.add_trace = function (smoothness) {
  var segments = this.model.extract_trace();
  var visible_atoms = [].concat.apply([], segments);
  var colors = color_by(this.conf.color_aim, visible_atoms, this.conf.colors);
  var line_factory = new LineFactory(use_gl_lines, {
    linewidth: get_line_width(this.conf),
    size: this.conf.window_size
  });
  var k = 0;
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var color_slice = colors.slice(k, k + seg.length);
    k += seg.length;
    var line = line_factory.make_line(seg, color_slice, smoothness);
    this.atomic_objects.push(line);
  }
};

ModelBag.prototype.add_ribbon = function (smoothness) {
  var segments = this.model.extract_trace();
  var res_map = this.model.get_residues();
  var visible_atoms = [].concat.apply([], segments);
  var colors = color_by(this.conf.color_aim, visible_atoms, this.conf.colors);
  var k = 0;
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var tangents = [];
    var last = [0, 0, 0];
    for (var j = 0; j < seg.length; j++) {
      var residue = res_map[seg[j].resid()];
      var tang = this.model.calculate_tangent_vector(residue);
      // untwisting (usually applies to beta-strands)
      if (tang[0]*last[0] + tang[1]*last[1] + tang[2]*last[2] < 0) {
        tang[0] = -tang[0];
        tang[1] = -tang[1];
        tang[2] = -tang[2];
      }
      tangents.push(tang);
      last = tang;
    }
    var color_slice = colors.slice(k, k + seg.length);
    k += seg.length;
    var obj = LineFactory.make_ribbon(seg, color_slice, tangents, smoothness);
    this.atomic_objects.push(obj);
  }
};


function Viewer(element_id) {
  this.config = {
    bond_line: 4.0, // for 700px height (in Coot it also depends on height)
    map_line: 1.25,  // for any height
    map_radius: 10.0,
    map_style: MAP_STYLES[0],
    render_style: RENDER_STYLES[0],
    color_aim: COLOR_AIMS[0],
    colors: set_colors('dark', {}),
    hydrogens: false,
    window_size: [1, 1] // it will be set in resize()
  };

  // rendered objects
  this.model_bags = [];
  this.map_bags = [];
  this.decor = {cell_box: null, selection: null};
  this.nav = null;

  this.last_ctr = new THREE.Vector3(Infinity, 0, 0);
  this.initial_hud_text = null;
  this.initial_hud_bg = '';
  this.selected_atom = null;
  this.active_model_bag = null;
  this.scene = new THREE.Scene();
  this.target = new THREE.Vector3();
  this.camera = new THREE.OrthographicCamera();
  //this.scene.add(this.camera); // no need to to this in recent three?
  this.scene.fog = new THREE.Fog(this.config.colors.bg, 0, 1);
  this.light = new THREE.AmbientLight(0xffffff);
  this.scene.add(this.light);
  this.controls = new Controls(this.camera, this.target);

  if (typeof document === 'undefined') return;  // for testing on node

  this.renderer = new THREE.WebGLRenderer({antialias: true});
  this.renderer.setClearColor(this.config.colors.bg, 1);
  this.renderer.setPixelRatio(window.devicePixelRatio);
  this.resize();
  this.camera.zoom = this.camera.right / 35.0;
  var container = document.getElementById(element_id);
  if (container === null) { // for testing
    return;
  }
  container.appendChild(this.renderer.domElement);
  if (window.Stats) {
    this.stats = new window.Stats();
    container.appendChild(this.stats.dom);
  }

  window.addEventListener('resize', this.resize.bind(this));
  window.addEventListener('keydown', this.keydown.bind(this));
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('mousewheel', this.mousewheel.bind(this));
  window.addEventListener('MozMousePixelScroll', this.mousewheel.bind(this));
  window.addEventListener('mousedown', this.mousedown.bind(this));
  window.addEventListener('touchstart', this.touchstart.bind(this));
  window.addEventListener('touchmove', this.touchmove.bind(this));
  window.addEventListener('touchend', this.touchend.bind(this));
  window.addEventListener('touchcancel', this.touchend.bind(this));
  window.addEventListener('dblclick', this.dblclick.bind(this));

  var self = this;

  this.mousemove = function (event) {
    event.preventDefault();
    //event.stopPropagation();
    self.controls.move(relX(event), relY(event));
  };

  this.mouseup = function (event) {
    event.preventDefault();
    event.stopPropagation();
    self.controls.stop(self.active_model_bag);
    document.removeEventListener('mousemove', self.mousemove);
    document.removeEventListener('mouseup', self.mouseup);
    self.redraw_maps();
  };

  this.scheduled = false;
  this.request_render();
}

function get_line_width(config) {
  return config.bond_line * config.window_size[1] / 700;
}

Viewer.prototype.hud = function (text, type) {
  if (typeof document === 'undefined') return;  // for testing on node
  var el = document && document.getElementById('hud');
  if (el) {
    if (this.initial_hud_text === null) {
      this.initial_hud_text = el.textContent;
      this.initial_hud_bg = el.style['background-color'];
    }
    el.textContent = (text !== undefined ? text : this.initial_hud_text);
    el.style['background-color'] = (type !== 'ERR' ? this.initial_hud_bg
                                                   : '#b00');
    if (type === 'ERR') console.log('ERR: ' + text);
  } else {
    console.log('hud: ' + text);
  }
};

Viewer.prototype.redraw_center = function () {
  if (this.target.distanceToSquared(this.last_ctr) > 0.0001) {
    this.last_ctr.copy(this.target);
    if (this.mark) {
      this.scene.remove(this.mark);
    }
    this.mark = make_center_cube(0.1, this.target, this.config.colors.center);
    this.scene.add(this.mark);
  }
};

Viewer.prototype.redraw_maps = function (force) {
  this.redraw_center();
  for (var i = 0; i < this.map_bags.length; i++) {
    var map_bag = this.map_bags[i];
    if (force || this.target.distanceToSquared(map_bag.block_ctr) > 0.01) {
      this.redraw_map(map_bag);
    }
  }
};

Viewer.prototype.clear_el_objects = function (map_bag) {
  for (var i = 0; i < map_bag.el_objects.length; i++) {
    this.scene.remove(map_bag.el_objects[i]);
    map_bag.el_objects[i].geometry.dispose();
  }
  map_bag.el_objects = [];
};

Viewer.prototype.clear_atomic_objects = function (model) {
  if (model.atomic_objects) {
    for (var i = 0; i < model.atomic_objects.length; i++) {
      this.scene.remove(model.atomic_objects[i]);
    }
  }
  model.atomic_objects = null;
};

Viewer.prototype.set_atomic_objects = function (model_bag) {
  model_bag.atomic_objects = [];
  switch (model_bag.conf.render_style) {
    case 'lines':
      model_bag.add_bonds();
      break;
    case 'ball&stick':
      var h_scale = this.camera.projectionMatrix.elements[5];
      var ball_size = Math.max(1, 200 * h_scale);
      model_bag.add_bonds(false, ball_size);
      break;
    case 'trace':  // + lines for ligands
      model_bag.add_trace();
      model_bag.add_bonds(true);
      break;
    case 'ribbon':
      model_bag.add_ribbon(8);
      model_bag.add_bonds(true);
      break;
  }
  for (var i = 0; i < model_bag.atomic_objects.length; i++) {
    this.scene.add(model_bag.atomic_objects[i]);
  }
};

Viewer.prototype.toggle_map_visibility = function (map_bag) {
  if (typeof map_bag === 'number') {
    map_bag = this.map_bags[map_bag];
  }
  map_bag.visible = !map_bag.visible;
  this.redraw_map(map_bag);
};

Viewer.prototype.redraw_map = function (map_bag) {
  this.clear_el_objects(map_bag);
  if (map_bag.visible) {
    map_bag.map.block = null;
    this.add_el_objects(map_bag);
  }
};

Viewer.prototype.toggle_model_visibility = function (model_bag) {
  model_bag = model_bag || this.active_model_bag;
  model_bag.visible = !model_bag.visible;
  this.redraw_model(model_bag);
};

Viewer.prototype.redraw_model = function (model_bag) {
  this.clear_atomic_objects(model_bag);
  if (model_bag.visible) {
    this.set_atomic_objects(model_bag);
  }
};

Viewer.prototype.redraw_models = function () {
  for (var i = 0; i < this.model_bags.length; i++) {
    this.redraw_model(this.model_bags[i]);
  }
};

Viewer.prototype.add_el_objects = function (map_bag) {
  if (!map_bag.visible) return;
  if (!map_bag.map.block) {
    map_bag.block_ctr.copy(this.target);
    map_bag.map.extract_block(this.config.map_radius,
                              [this.target.x, this.target.y, this.target.z]);
  }
  for (var i = 0; i < map_bag.types.length; i++) {
    var mtype = map_bag.types[i];
    var isolevel = (mtype === 'map_neg' ? -1 : 1) * map_bag.isolevel;
    var iso = map_bag.map.isomesh_in_block(isolevel, this.config.map_style);

    var obj = LineFactory.make_chickenwire(iso, {
      color: this.config.colors[mtype],
      linewidth: this.config.map_line
    });
    map_bag.el_objects.push(obj);
    this.scene.add(obj);
  }
};

Viewer.prototype.change_isolevel_by = function (map_idx, delta) {
  if (map_idx >= this.map_bags.length) return;
  var map_bag = this.map_bags[map_idx];
  map_bag.isolevel += delta;
  var abs_level = map_bag.map.abs_level(map_bag.isolevel);
  this.hud('map ' + (map_idx+1) + ' level =  ' + abs_level.toFixed(4) +
           'e/A^3 (' + map_bag.isolevel.toFixed(2) + ' rmsd)');
  //TODO: move slow part into update()
  this.clear_el_objects(map_bag);
  this.add_el_objects(map_bag);
};

Viewer.prototype.change_map_radius = function (delta) {
  var RMIN = 2;
  var RMAX = 40;
  var cf = this.config;
  cf.map_radius = Math.min(Math.max(cf.map_radius + delta, RMIN), RMAX);
  var info = 'map "radius": ' + cf.map_radius;
  if (cf.map_radius === RMAX) info += ' (max)';
  else if (cf.map_radius === RMIN) info += ' (min)';
  this.hud(info);
  this.redraw_maps(true); //TODO: move slow part into update()
};

Viewer.prototype.toggle_cell_box = function () {
  if (this.decor.cell_box) {
    this.scene.remove(this.decor.cell_box);
    this.decor.cell_box = null;
  } else {
    var uc = null;
    if (this.model_bags.length > 0) {
      uc = this.model_bags[0].model.unit_cell;
    }
    // model may not have unit cell
    if (!uc && this.map_bags.length > 0) {
      uc = this.map_bags[0].map.unit_cell;
    }
    if (uc) {
      this.decor.cell_box = make_unitcell_box(uc, this.config.colors.cell_box);
      this.scene.add(this.decor.cell_box);
    }
  }
};

Viewer.prototype.shift_clip = function (away) {
  var eye = this.camera.position.clone().sub(this.target).setLength(1);
  if (!away) {
    eye.negate();
  }
  this.target.add(eye);
  this.camera.position.add(eye);
  this.update_camera();
  this.redraw_maps();
  this.hud('clip shifted by [' + vec3_to_str(eye, 2, ' ') + ']');
};

Viewer.prototype.go_to_nearest_Ca = function () {
  var t = this.target;
  if (this.active_model_bag === null) return;
  var a = this.active_model_bag.model.get_nearest_atom(t.x, t.y, t.z, 'CA');
  if (a) {
    this.hud(a.long_label());
    //this.set_selection(a);
    this.controls.go_to(new THREE.Vector3(a.xyz[0], a.xyz[1], a.xyz[2]),
                        null, null, 30 / auto_speed);
    this.selected_atom = a;
  } else {
    this.hud('no nearby CA');
  }
};

Viewer.prototype.redraw_all = function () {
  this.scene.fog.color = this.config.colors.bg;
  if (this.renderer) this.renderer.setClearColor(this.config.colors.bg, 1);
  this.redraw_models();
  this.redraw_maps(true);
};

Viewer.prototype.toggle_help = function () {
  var el = document.getElementById('help');
  if (!el) return;
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
  if (el.innerHTML === '') {
    el.innerHTML = [
      '<b>mouse:</b>',
      'Left = rotate',
      'Middle or Ctrl+Left = pan',
      'Right = zoom',
      'Ctrl+Right = clipping',
      'Ctrl+Shift+Right = roll',
      'Wheel = σ level',
      'Shift+Wheel = diff map σ',

      '\n<b>keyboard:</b>',
      'H = toggle help',
      'T = representation',
      'C = coloring',
      'Shift+C = bg color',
      '+/- = sigma level',
      ']/[ = map radius',
      'D/F = clip width',
      'numpad 3/. = move clip',
      'M/N = zoom',
      'U = unitcell box',
      'Y = hydrogens',
      'R = center view',
      'W = wireframe style',
      'I = spin',
      'Shift+I = rock',
      'Home/End = bond width',
      'P = nearest Cα',
      'Shift+P = permalink',
      '(Shift+)space = next res.',

      '\n<a href="https://uglymol.github.io">about uglymol</a>'].join('\n');
  }
};

function next(elem, arr) {
  return arr[(arr.indexOf(elem) + 1) % arr.length];
}

function vec3_to_str(vec, n, sep) {
  return vec.x.toFixed(n) + sep + vec.y.toFixed(n) + sep + vec.z.toFixed(n);
}

Viewer.prototype.keydown = function (evt) {  // eslint-disable-line complexity
  var key = evt.keyCode;
  switch (key) {
    case 84:  // t
      this.config.render_style = next(this.config.render_style, RENDER_STYLES);
      this.hud('rendering as ' + this.config.render_style);
      this.redraw_models();
      break;
    case 67:  // c
      if (evt.shiftKey) {
        set_colors(next(this.config.colors.name, Object.keys(ColorSchemes)),
                   this.config.colors);
        this.hud('color scheme: ' + this.config.colors.name);
        this.redraw_all();
      } else { // color-by
        this.config.color_aim = next(this.config.color_aim, COLOR_AIMS);
        this.hud('coloring by ' + this.config.color_aim);
        this.redraw_models();
      }
      break;
    case 87:  // w
      this.config.map_style = next(this.config.map_style, MAP_STYLES);
      this.hud('map style: ' + this.config.map_style);
      this.redraw_maps(true);
      break;
    case 89:  // y
      this.config.hydrogens = !this.config.hydrogens;
      this.hud((this.config.hydrogens ? 'show' : 'hide') +
               ' hydrogens (if any)');
      //XXX
      use_gl_lines = !use_gl_lines;
      this.redraw_models();
      break;
    case 107:  // add
    case 61:  // equals/firefox
    case 187:  // equal sign
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, 0.1);
      break;
    case 109:  // subtract
    case 173:  // minus/firefox
    case 189:  // dash
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, -0.1);
      break;
    case 219:  // [
      this.change_map_radius(-2);
      break;
    case 221:  // ]
      this.change_map_radius(2);
      break;
    case 68:  // d
    case 70:  // f
      this.controls.change_slab_width(key === 68 ? -0.1 : +0.1);
      this.update_camera();
      this.hud('clip width: ' + (this.camera.far-this.camera.near).toFixed(1));
      break;
    case 77:  // m
    case 78:  // n
      this.camera.zoom *= (key === 77 ? 1.03 : (1 / 1.03));
      this.update_camera();
      this.hud('zoom: ' + this.camera.zoom.toFixed(2));
      break;
    case 80:  // p
      if (evt.shiftKey) {
        window.location.hash = '#xyz=' + vec3_to_str(this.target, 1, ',') +
          '&eye=' + vec3_to_str(this.camera.position, 1, ',') +
          '&zoom=' + this.camera.zoom.toFixed(0);
        this.hud('copy URL from the location bar');
      } else {
        this.go_to_nearest_Ca();
      }
      break;
    case 51:  // 3
    case 99:  // numpad 3
      this.shift_clip(true);
      break;
    case 108:  // numpad period (Linux)
    case 110:  // decimal point (Mac)
      this.shift_clip(false);
      break;
    case 85:  // u
      this.hud('toggled unit cell box');
      this.toggle_cell_box();
      break;
    case 73:  // i
      this.hud('toggled camera movement');
      this.controls.toggle_auto({rock: evt.shiftKey});
      break;
    case 82:  // r
      if (evt.shiftKey) {
        this.hud('redraw!');
        this.redraw_all();
      } else {
        this.hud('model recentered');
        this.recenter();
      }
      break;
    case 72:  // h
      this.toggle_help();
      break;
    case 36: // Home
    case 35: // End
      this.config.bond_line += (key === 36 ? 0.2 : -0.2);
      this.config.bond_line = Math.max(this.config.bond_line, 0.1);
      this.redraw_models();
      this.hud('bond width: ' + get_line_width(this.config).toFixed(1));
      break;
    case 16: // shift
    case 17: // ctrl
    case 18: // alt
    case 225: // altgr
      break;
    case 32: // Space
      this.center_next_residue(evt.shiftKey);
      break;
    default:
      this.hud('Nothing here. Press H for help.');
      break;
  }
  this.request_render();
};

Viewer.prototype.mousedown = function (event) {
  event.preventDefault();
  event.stopPropagation();
  var state = STATE.NONE;
  if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
    state = STATE.PAN;
  } else if (event.button === 0) {
    // in Coot shift+Left is labeling atoms like dblclick, + rotation
    if (event.shiftKey) {
      this.dblclick(event);
    }
    state = STATE.ROTATE;
  } else if (event.button === 2) {
    if (event.ctrlKey) {
      state = event.shiftKey ? STATE.ROLL : STATE.SLAB;
    } else {
      state = STATE.ZOOM;
    }
  }
  this.controls.start(state, relX(event), relY(event));
  document.addEventListener('mousemove', this.mousemove);
  document.addEventListener('mouseup', this.mouseup);
  this.request_render();
};

Viewer.prototype.dblclick = function (event) {
  if (event.button !== 0) return;
  if (this.decor.selection) {
    this.scene.remove(this.decor.selection);
    this.decor.selection = null;
  }
  var mouse = new THREE.Vector2(relX(event), relY(event));
  var atom;
  if (this.active_model_bag !== null) {
    atom = this.active_model_bag.pick_atom(get_raycaster(mouse, this.camera));
  }
  if (atom) {
    this.hud(atom.long_label());
    this.set_selection(atom);
  } else {
    this.hud();
  }
  this.request_render();
};

Viewer.prototype.set_selection = function (atom) {
  var geometry = new THREE.Geometry();
  geometry.vertices.push(new THREE.Vector3(atom.xyz[0], atom.xyz[1],
                                           atom.xyz[2]));
  var color = this.config.colors[atom.element] || this.config.colors.def;
  var material = new THREE.PointsMaterial({size: 3, color: color});
  this.decor.selection = new THREE.Points(geometry, material);
  this.scene.add(this.decor.selection);
};

// for two-finger touch events
function touch_info(evt) {
  var touches = evt.touches;
  var dx = touches[0].pageX - touches[1].pageX;
  var dy = touches[0].pageY - touches[1].pageY;
  return {pageX: (touches[0].pageX + touches[1].pageX) / 2,
          pageY: (touches[0].pageY + touches[1].pageY) / 2,
          dist: Math.sqrt(dx * dx + dy * dy)};
}

Viewer.prototype.touchstart = function (event) {
  var touches = event.touches;
  if (touches.length === 1) {
    this.controls.start(STATE.ROTATE, relX(touches[0]), relY(touches[0]));
  } else { // for now using only two touches
    var info = touch_info(event);
    this.controls.start(STATE.PAN_ZOOM, relX(info), relY(info), info.dist);
  }
  this.request_render();
};

Viewer.prototype.touchmove = function (event) {
  event.preventDefault();
  event.stopPropagation();
  var touches = event.touches;
  if (touches.length === 1) {
    this.controls.move(relX(touches[0]), relY(touches[0]));
  } else { // for now using only two touches
    var info = touch_info(event);
    this.controls.move(relX(info), relY(info), info.dist);
  }
};

Viewer.prototype.touchend = function (/*event*/) {
  this.controls.stop();
  this.redraw_maps();
};

Viewer.prototype.mousewheel = function (evt) {
  evt.preventDefault();
  evt.stopPropagation();
  // evt.wheelDelta for WebKit, evt.detail for Firefox
  var delta = evt.wheelDelta ? evt.wheelDelta / 2000
                             : (evt.detail || 0) / -1000;
  this.change_isolevel_by(evt.shiftKey ? 1 : 0, delta);
  this.request_render();
};

Viewer.prototype.resize = function (/*evt*/) {
  var width = window.innerWidth;
  var height = window.innerHeight;
  this.camera.left = -width;
  this.camera.right = width;
  this.camera.top = height;
  this.camera.bottom = -height;
  this.camera.updateProjectionMatrix();
  this.renderer.setSize(width, height);
  if (width !== this.config.window_size[0] ||
      height !== this.config.window_size[1]) {
    this.config.window_size[0] = width;
    this.config.window_size[1] = height;
    this.redraw_models();
  }
  this.request_render();
};

// makes sense only for full-window viewer
function parse_url_fragment() {
  var ret = {};
  if (typeof window === 'undefined') return ret;
  var params = window.location.hash.substr(1).split('&');
  for (var i = 0; i < params.length; i++) {
    var kv = params[i].split('=');
    var val = kv[1];
    if (kv[0] === 'xyz' || kv[0] === 'eye') {
      val = val.split(',').map(Number);
    } else if (kv[0] === 'zoom') {
      val = Number(val);
    }
    ret[kv[0]] = val;
  }
  return ret;
}

// If xyz set recenter on it looking toward the model center.
// Otherwise recenter on the model center looking along the z axis.
Viewer.prototype.recenter = function (xyz, eye, steps) {
  var new_up = null;
  var ctr;
  if (xyz == null || eye == null) {
    ctr = this.active_model_bag.model.get_center();
  }
  if (eye) {
    eye = new THREE.Vector3(eye[0], eye[1], eye[2]);
  }
  if (xyz == null) { // center on the molecule
    if (this.active_model_bag === null) return;
    xyz = new THREE.Vector3(ctr[0], ctr[1], ctr[2]);
    if (!eye) {
      eye = xyz.clone();
      eye.z += 100;
      new_up = THREE.Object3D.DefaultUp; // Vector3(0, 1, 0)
    }
  } else {
    xyz = new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
    if (eye == null && this.active_model_bag !== null) {
      // look toward the center of the molecule
      eye = new THREE.Vector3(ctr[0], ctr[1], ctr[2]);
      eye.sub(xyz).negate().setLength(100); // we store now (eye - xyz)
      new_up = new THREE.Vector3(0, 1, 0).projectOnPlane(eye);
      var len = new_up.length();
      if (len < 0.1) { // the center is in [0,1,0] direction
        new_up.set(1, 0, 0).projectOnPlane(eye);
        len = new_up.length();
      }
      new_up.divideScalar(len); // normalizes
      eye.add(xyz);
    }
  }
  this.controls.go_to(xyz, eye, new_up, steps);
};

Viewer.prototype.center_next_residue = function (back) {
  if (!this.active_model_bag) return;
  var a = this.active_model_bag.model.next_residue(this.selected_atom, back);
  if (a) {
    this.hud('-> ' + a.long_label());
    this.controls.go_to(new THREE.Vector3(a.xyz[0], a.xyz[1], a.xyz[2]),
                        null, null, 30 / auto_speed);
    this.selected_atom = a;
  }
};

Viewer.prototype.update_camera = function () {
  var dxyz = this.camera.position.distanceTo(this.target);
  // the far plane is more distant from the target than the near plane (3:1)
  var w = 0.25 * this.controls.slab_width() / this.camera.zoom;
  this.camera.near = dxyz * (1 - w);
  this.camera.far = dxyz * (1 + 3 * w);
  //this.light.position.copy(this.camera.position);
  var h_scale = this.camera.projectionMatrix.elements[5];
  this.camera.updateProjectionMatrix();
  // temporary hack - scaling balls
  if (h_scale !== this.camera.projectionMatrix.elements[5]) {
    var ball_size = Math.max(1, 80 * this.camera.projectionMatrix.elements[5]);
    for (var i = 0; i < this.model_bags.length; i++) {
      var obj = this.model_bags[i].atomic_objects;
      if (obj.length === 2 && obj[1].material.size) {
        obj[1].material.size = ball_size;
      }
    }
  }
};

Viewer.prototype.render = function () {
  if (this.controls.update()) {
    this.update_camera();
  }
  if (!this.controls.is_going()) {
    this.redraw_maps();
  }
  this.renderer.render(this.scene, this.camera);
  if (this.nav) {
    this.nav.renderer.render(this.nav.scene, this.camera);
  }
  this.scheduled = false;
  if (this.controls.is_moving()) {
    this.request_render();
  }
  if (this.stats) {
    this.stats.update();
  }
};

Viewer.prototype.request_render = function () {
  if (typeof window !== 'undefined' && !this.scheduled) {
    this.scheduled = true;
    window.requestAnimationFrame(this.render.bind(this));
  }
};

Viewer.prototype.set_model = function (model) {
  var model_bag = new ModelBag(model, this.config);
  this.model_bags.push(model_bag);
  this.set_atomic_objects(model_bag);
  this.active_model_bag = model_bag;
  this.request_render();
};

Viewer.prototype.add_map = function (map, is_diff_map) {
  //map.show_debug_info();
  var map_bag = new MapBag(map, is_diff_map);
  this.map_bags.push(map_bag);
  this.add_el_objects(map_bag);
  this.request_render();
};

Viewer.prototype.load_file = function (url, binary, callback) {
  var req = new XMLHttpRequest();
  req.open('GET', url, true);
  if (binary) {
    req.responseType = 'arraybuffer';
  } else {
    // http://stackoverflow.com/questions/7374911/
    req.overrideMimeType('text/plain');
  }
  var self = this;
  req.onreadystatechange = function () {
    if (req.readyState === 4) {
      // chrome --allow-file-access-from-files gives status 0
      if (req.status === 200 || (req.status === 0 && req.response !== null)) {
        try {
          callback(req);
        } catch (e) {
          self.hud('Error: ' + e.message + '\nin ' + url, 'ERR');
        }
      } else {
        self.hud('Failed to fetch ' + url, 'ERR');
      }
    }
  };
  req.send(null);
};

// Load molecular model from PDB file and centers the view
Viewer.prototype.load_pdb = function (url, options) {
  options = options || {};
  var self = this;
  this.load_file(url, false, function (req) {
    var model = new Model();
    model.from_pdb(req.responseText);
    self.set_model(model);
    var frag = parse_url_fragment();
    if (frag.zoom) self.camera.zoom = frag.zoom;
    self.recenter(options.center || frag.xyz, frag.eye, 1);
    if (options.callback) options.callback();
  });
};

Viewer.prototype.load_map = function (url, is_diff_map, filetype, callback) {
  if (filetype !== 'ccp4' && filetype !== 'dsn6') {
    throw Error('Unknown map filetype.');
  }
  var self = this;
  this.load_file(url, true, function (req) {
    var map = new ElMap();
    if (filetype === 'ccp4') map.from_ccp4(req.response);
    else /* === 'dsn6'*/ map.from_dsn6(req.response);
    self.add_map(map, is_diff_map);
    if (callback) callback();
  });
};

// Load a normal map and a difference map.
// To show the first map ASAP we do not download both maps in parallel.
Viewer.prototype.load_ccp4_maps = function (url1, url2, callback) {
  var self = this;
  this.load_map(url1, false, 'ccp4', function () {
    self.load_map(url2, true, 'ccp4', callback);
  });
};

// TODO: navigation window like in gimp and mifit
/*
Viewer.prototype.show_nav = function (inset_id) {
  var inset = document.getElementById(inset_id);
  if (!inset) return;
  inset.style.display = 'block';
  var nav = {};
  nav.renderer = new THREE.WebGLRenderer();
  nav.renderer.setClearColor(0x555555, 1);
  nav.renderer.setSize(200, 200);
  inset.appendChild(nav.renderer.domElement);
  //nav.scene = new THREE.Scene();
  nav.scene = this.scene;
  //var light = new THREE.AmbientLight(0xffffff);
  //nav.scene.add(light);
  this.nav = nav;
};
*/

Viewer.ColorSchemes = ColorSchemes;
Viewer.auto_speed = auto_speed;

return Viewer;
})();

if (typeof module !== 'undefined') module.exports = Viewer;
