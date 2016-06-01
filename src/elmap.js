
var UnitCell = UnitCell || require('./unitcell'); // eslint-disable-line

var ElMap = (function () {
'use strict';

function GridArray(n_real, n_grid) {
  this.n_real = n_real; // actual dimensions of the map area
  this.n_grid = n_grid; // dimensions of the grid for the entire unit cell
  this.size = n_real[0] * n_real[1] * n_real[2];
  this.values = new Float32Array(this.size);
}

GridArray.prototype.grid2index = function (i, j, k) {
  var i_ = i % this.n_real[0];
  var j_ = j % this.n_real[1];
  var k_ = k % this.n_real[2];
  if (i_ < 0) { i_ += this.n_real[0]; }
  if (j_ < 0) { j_ += this.n_real[1]; }
  if (k_ < 0) { k_ += this.n_real[2]; }
  return ((i_ * this.n_real[1] + j_) * this.n_real[2] + k_);
};

GridArray.prototype.grid2frac = function (i, j, k) {
  return [i / this.n_grid[0], j / this.n_grid[1], k / this.n_grid[2]];
};

// return the equivalent grid coordinates (rounded down) for the given
// fractional coordinates.
GridArray.prototype.frac2grid = function (xyz) {
  return [Math.floor(xyz[0] * this.n_grid[0]),
          Math.floor(xyz[1] * this.n_grid[1]),
          Math.floor(xyz[2] * this.n_grid[2])];
};

GridArray.prototype.set_grid_value = function (i, j, k, value) {
  var idx = this.grid2index(i, j, k);
  if (idx >= this.size) {
    throw Error('Array overflow with indices ' + i + ',' + j + ',' + k);
  }
  this.values[idx] = value;
};

GridArray.prototype.get_grid_value = function (i, j, k) {
  var idx = this.grid2index(i, j, k);
  if (idx >= this.size) {
    throw Error('Array overflow with indices ' + i + ',' + j + ',' + k);
  }
  return this.values[idx];
};

function calculate_stddev(a) {
  var n = a.length;
  var sum = 0;
  var sq_sum = 0;
  for (var i = 0; i < n; i++) {
    sum += a[i];
    sq_sum += a[i] * a[i];
  }
  var mean = sum / n;
  var variance = sq_sum / n - mean * mean;
  return {mean: mean, dev: Math.sqrt(variance)};
}

function ElMap() {
  this.unit_cell = null;
  this.grid = null;
  this.mean = 0.0;
  this.rms = 1.0;
}

ElMap.prototype.abs_level = function (sigma) {
  return sigma * this.rms + this.mean;
};

// http://www.ccp4.ac.uk/html/maplib.html#description
ElMap.prototype.from_ccp4 = function (buf) {
  //console.log('buf type: ' + Object.prototype.toString.call(buf));
  var iview = new Int32Array(buf);
  var fview = new Float32Array(buf);
  var n_crs = [iview[0], iview[1], iview[2]];
  this.mode = iview[3];
  if (this.mode !== 2) {
    throw Error('Only Mode 2 (32-bit float) of CCP4 map is supported.');
  }
  var start = [iview[4], iview[5], iview[6]];
  var n_grid = [iview[7], iview[8], iview[9]];
  this.unit_cell = new UnitCell(fview[10], fview[11], fview[12],
                                fview[13], fview[14], fview[15]);
  var c = iview[16] - 1;  // MAPC - axis corresp to cols (1,2,3 for X,Y,Z)
  var r = iview[17] - 1;  // MAPR - rows
  var s = iview[18] - 1;  // MAPR - sections
  this.min = fview[19];
  this.max = fview[20];
  this.mean = fview[21];  // is it reliable?
  this.sg_number = iview[22];
  this.lskflg = iview[24];
  this.rms = fview[54]; // is it reliable?
  //console.log('map mean: ' + this.mean.toFixed(4) +
  //            '  rms: ' + this.rms.toFixed(4));
  var n_real = [n_crs[c], n_crs[r], n_crs[s]];
  this.grid = new GridArray(n_real, n_grid);
  var idx = 256;
  var end_crs = [n_crs[0] + start[0],
                 n_crs[1] + start[1],
                 n_crs[2] + start[2]];
  var it = [0, 0, 0];
  for (it[2] = start[2]; it[2] < end_crs[2]; it[2]++) {
    for (it[1] = start[1]; it[1] < end_crs[1]; it[1]++) {
      for (it[0] = start[0]; it[0] < end_crs[0]; it[0]++) {
        this.grid.set_grid_value(it[c], it[r], it[s], fview[idx]);
        idx++;
      }
    }
  }
  if (idx !== iview.length) {
    throw Error('ccp4 file too short or too long');
  }
};

// DSN6 MAP FORMAT
// http://www.uoxray.uoregon.edu/tnt/manual/node104.html
// This format is much different from CCP4/MRC maps, and was obviously
// designed for vastly more primitive computers.  Since density values are
// stored as bytes rather than (4-byte) floates, it has the big advantage
// of being significantly more compact than CCP4 maps.
ElMap.prototype.from_dsn6 = function (buf) {
  //console.log('buf type: ' + Object.prototype.toString.call(buf));
  var u8data = new Uint8Array(buf);
  var iview = new Int16Array(u8data.buffer);
  if (iview[18] !== 100) {
    var len = iview.length;  // or only header, 256?
    for (var n = 0; n < len; n++) {
      // swapping bytes with Uint8Array like this:
      // var tmp=u8data[n*2]; u8data[n*2]=u8data[n*2+1]; u8data[n*2+1]=tmp;
      // was slowing down this whole function 5x times (!?) on Node.
      var val = iview[n];
      iview[n] = ((val & 0xff) << 8) | ((val >> 8) & 0xff);
    }
  }
  if (iview[18] !== 100) {
    throw Error('Endian swap failed');
  }
  var origin = [iview[0], iview[1], iview[2]];
  var n_real = [iview[3], iview[4], iview[5]];
  var n_grid = [iview[6], iview[7], iview[8]];
  var cell_mult = 1.0 / iview[17];
  this.unit_cell = new UnitCell(cell_mult * iview[9],
                                cell_mult * iview[10],
                                cell_mult * iview[11],
                                cell_mult * iview[12],
                                cell_mult * iview[13],
                                cell_mult * iview[14]);
  this.grid = new GridArray(n_real, n_grid);
  var prod = iview[15] / 100;
  var plus = iview[16];
  //var data_scale_factor = iview[15] / iview[18] + iview[16];
  // bricks have 512 (8x8x8) values
  var offset = 512;
  var n_blocks = [Math.ceil(n_real[0] / 8),
                  Math.ceil(n_real[1] / 8),
                  Math.ceil(n_real[2] / 8)];
  for (var zz = 0; zz < n_blocks[2]; zz++) {
    for (var yy = 0; yy < n_blocks[1]; yy++) {
      for (var xx = 0; xx < n_blocks[0]; xx++) { // loop over bricks
        for (var k = 0; k < 8; k++) {
          var z = 8 * zz + k;
          for (var j = 0; j < 8; j++) {
            var y = 8 * yy + j;
            for (var i = 0; i < 8; i++) { // loop inside brick
              var x = 8 * xx + i;
              if (x < n_real[0] && y < n_real[1] && z < n_real[2]) {
                var density = (u8data[offset] - plus) / prod;
                offset++;
                this.grid.set_grid_value(origin[0] + x,
                                         origin[1] + y,
                                         origin[2] + z, density);
              } else {
                offset += 8 - i;
                break;
              }
            }
          }
        }
      }
    }
  }
  var d = calculate_stddev(this.grid.values);
  this.mean = d.mean;
  this.rms = d.dev;
  //this.show_debug_info();
};

ElMap.prototype.show_debug_info = function () {
  console.log('map size: ' + this.grid.n_real);
  console.log('unit cell: ' + this.unit_cell.parameters.join(', '));
  console.log('unit cell grid: ' + this.grid.n_grid);
};

// Extract a block of density for calculating an isosurface using the
// separate marching cubes implementation.
ElMap.prototype.extract_block = function (radius, center) {
  var grid = this.grid;
  var unit_cell = this.unit_cell;
  var xyz_min = [center[0] - radius, center[1] - radius, center[2] - radius];
  var xyz_max = [center[0] + radius, center[1] + radius, center[2] + radius];
  var frac_min = unit_cell.fractionalize(xyz_min);
  var frac_max = unit_cell.fractionalize(xyz_max);
  var grid_min = grid.frac2grid(frac_min);
  var grid_max = grid.frac2grid(frac_max);
  var nx = grid_max[0] - grid_min[0] + 1;
  var ny = grid_max[1] - grid_min[1] + 1;
  var nz = grid_max[2] - grid_min[2] + 1;
  var points = [];
  var values = [];
  for (var k = grid_min[2]; k <= grid_max[2]; k++) {
    for (var j = grid_min[1]; j <= grid_max[1]; j++) {
      for (var i = grid_min[0]; i <= grid_max[0]; i++) {
        var frac = grid.grid2frac(i, j, k);
        var orth = unit_cell.orthogonalize(frac);
        points.push(orth);
        var map_value = grid.get_grid_value(i, j, k);
        values.push(map_value);
      }
    }
  }
  this.block = {points: points, values: values, size: [nx, ny, nz]};
};

return ElMap;
})();

if (typeof module !== 'undefined') { module.exports = ElMap; }
