raja-minify
===========

After initialization of raja in your express app,

dom.author(require('raja-minify')(raja));

will automatically process "minify" attributes that are declared on script, link
tags:

```
<script src="dir/file1.js" minify></script>
```

is replaced by
```
<script src="dir/file1.min.js"></script>
```

Concatenation is simply done with:

```
<script src="dir/file1.js" minify="dir/bundle.js"></script>
<script src="dir/file2.js" minify="dir/bundle.js"></script>
```

and result in

```
<script src="dir/bundle.js"></script>
```

and likewise for CSS, with automatic url rebasing, autoprefixer, and compression.


Planned feature(s)
------------------

* Ability to pass options to uglify-js, autoprefixer-core, csswring.
* Automatic source maps - you don't even know you generated them.


