---
layout: default
---


UglyMol is a web-based macromolecular viewer focused on electron density.

It makes models and e.den. maps easy to recognize, navigate and interpret --
for crystallographers.
It looks like [Coot](http://www2.mrc-lmb.cam.ac.uk/personal/pemsley/coot/)
and walks (mouse controls) like Coot.
But it's only a viewer. For situations when you want
a quick look without downloading the data and starting Coot.
For instance, when screening
[Dimple](http://ccp4.github.io/dimple/) results in a synchrotron.
Of course, for this to work, it needs to be integrated into a website
that provides the data access
(see the [FAQ](https://github.com/uglymol/uglymol/wiki) on how to do it).

Try it:

- [1MRU](1mru.html) (60kDa, 3Å),
  and in [dual view](dual.html) with PDB_REDO,
- [a blob](dimple_thaum.html#xyz=14,18,12&eye=80,71,-41&zoom=70)
  (Dimple result, thaumatin, 1.4Å),
- or any [local file or wwPDB entry](view/).


It also has a [reciprocal space spin-off](reciprocal.html?rlp=data/rlp.csv).

UglyMol is a small (~3 KLOC) [project](https://github.com/uglymol/uglymol)
forked from Nat Echols' [xtal.js](https://github.com/natechols/xtal.js/).
The [plan](https://github.com/uglymol/uglymol/blob/master/TODO.md)
is to keep it small. But if you're missing some functionality,
it won't hurt if you get in touch --
use [Issues](https://github.com/uglymol/uglymol/issues)
or [chat](https://gitter.im/ccp4/dimple)
or [email](mailto:wojdyr@gmail.com).

See the [Wiki](https://github.com/uglymol/uglymol/wiki)
for more information.
