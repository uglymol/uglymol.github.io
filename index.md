---
layout: default
---

UglyMol is a web-based macromolecular viewer focused on electron density.

It makes models and e.den. maps easy to recognize, navigate and interpret --
for [Coot](http://www2.mrc-lmb.cam.ac.uk/personal/pemsley/coot/) users.
It looks like coot and walks (mouse controls) like coot.
Except when it doesn't -- see the
[FAQ](https://github.com/uglymol/uglymol/wiki).

It's only a viewer. For situations when you want
a quick look without downloading the data and starting Coot.
For instance, when screening
[Dimple](http://ccp4.github.io/dimple/) results in a synchrotron.
Of course, for this to work, it needs to be integrated into a website
that provides the data access.

Try it (if all lines are thin -- it's a known problem, see the first
point [here](https://github.com/uglymol/uglymol/blob/master/TODO.md)):

- [1MRU](https://uglymol.github.io/1mru.html) (60kDa, 3Å),
- xxxx (>200kDa, xÅ),
- a blob (thaumatin, Dimple result),
- SAD phasing.

Technically, UglyMol is a small
[project](https://github.com/uglymol/uglymol) (~2 KLOC)
forked from Nat Echols' [xtal.js](https://github.com/natechols/xtal.js/).
See the [FAQ](https://github.com/uglymol/uglymol/wiki).
on how to add it to your project.

The [plan](https://github.com/uglymol/uglymol/blob/master/TODO.md)
is to keep UglyMol small and ugly rather than to add many features.
And to make it as [fast](https://uglymol.github.io/perf.html) as possible.
Actually this project is an experiment and further development, if any,
will depend on received feedback. So, what do you think should be added
or changed?
Use the [issue tracker](https://github.com/uglymol/uglymol/issues)
or gitter [chat](https://gitter.im/ccp4/dimple)
or email wojdyr@gmail.com.

Finally, if you need pretty visualization,
or if you trust the model and don't need to see the electron density,
use one of many
[other viewers](https://github.com/uglymol/uglymol/wiki/MolecularViewers).
